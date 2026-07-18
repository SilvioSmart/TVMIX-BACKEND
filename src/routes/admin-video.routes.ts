import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Router, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  deleteR2Objects,
  deleteR2Prefix,
  objectKeyFromPublicUrl,
  r2,
  r2Config,
  r2Key,
  sanitizeR2FileName,
  uniqueObjectKeys,
} from "../lib/r2.js";
import { getTranscodeQueue } from "../lib/transcodeQueue.js";
import {
  handlePrismaError,
  nullableDateSchema,
  optionalUrlSchema,
  paginationSchema,
  sendValidationError,
  slugSchema,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

function hlsPrefixFromKey(objectKey: string | null | undefined): string | null {
  if (!objectKey) return null;
  const normalized = objectKey.replace(/\/+$/, "");
  if (normalized.endsWith("/master.m3u8")) {
    return `${normalized.slice(0, -"master.m3u8".length)}`;
  }
  const slash = normalized.lastIndexOf("/");
  return slash > 0 ? `${normalized.slice(0, slash + 1)}` : null;
}

async function deleteVideoArchiveFiles(video: {
  sourceObjectKey: string | null;
  convertedObjectKey: string | null;
  hlsUrl: string | null;
  thumbnailUrl: string | null;
}) {
  const hlsKey = video.convertedObjectKey ?? objectKeyFromPublicUrl(video.hlsUrl);
  const hlsPrefix = hlsPrefixFromKey(hlsKey);
  const objectKeys = uniqueObjectKeys([
    video.sourceObjectKey,
    hlsKey,
    objectKeyFromPublicUrl(video.thumbnailUrl),
  ]);
  const deletedObjects = await deleteR2Objects(objectKeys);
  const deletedPrefix = hlsPrefix ? await deleteR2Prefix(hlsPrefix) : { deleted: 0, errors: [] };
  return {
    deleted: deletedObjects.deleted + deletedPrefix.deleted,
    errors: [...deletedObjects.errors, ...deletedPrefix.errors],
  };
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg terminato con code=${code} signal=${signal ?? "none"}\n${stderr}`));
    });
  });
}

function safeFrameFileName(slug: string, seconds: number) {
  return sanitizeR2FileName(`${slug}-frame-${Math.round(seconds * 1000)}.jpg`);
}

function normalizeSlug(value: string) {
  return value.trim().replace(/^#+/, "");
}

function twoDigitNumber(value: number) {
  const normalized = Math.abs(value) % 100;
  return String(normalized).padStart(2, "0");
}

async function createEpisodeCode(seasonId: string | null | undefined, episodeNumber: number | null | undefined) {
  if (!seasonId || !episodeNumber) return null;
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { number: true, programId: true },
  });
  if (!season) return null;

  const programId = season.programId.toUpperCase();
  return `${programId[0] ?? "X"}${programId.at(-1) ?? "X"}${twoDigitNumber(season.number)}${twoDigitNumber(episodeNumber)}`;
}

async function validateEpisodeAssignment(
  res: Response,
  seasonId: string | null | undefined,
  episodeNumber: number | null | undefined,
  excludeVideoId?: string,
) {
  if (!seasonId && episodeNumber) {
    res.status(409).json({ error: "Se indichi il numero puntata devi selezionare anche la stagione/serie" });
    return false;
  }
  if (!seasonId || !episodeNumber) return true;

  const duplicate = await prisma.video.findFirst({
    where: {
      seasonId,
      episodeNumber,
      ...(excludeVideoId ? { id: { not: excludeVideoId } } : {}),
    },
    select: { id: true, title: true, episodeCode: true },
  });
  if (duplicate) {
    res.status(409).json({
      error: `Puntata già presente in catalogo: ${duplicate.title}${duplicate.episodeCode ? ` (${duplicate.episodeCode})` : ""}`,
    });
    return false;
  }

  return true;
}

const videoFields = z.object({
  title: z.string().trim().min(2).max(200),
  slug: slugSchema.or(z.string().trim().regex(/^#[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug non valido")).transform(normalizeSlug),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  thumbnailUrl: optionalUrlSchema,
  hlsUrl: optionalUrlSchema,
  sourceObjectKey: z.string().trim().max(1000).nullable().optional(),
  convertedObjectKey: z.string().trim().max(1000).nullable().optional(),
  originalFileName: z.string().trim().max(255).nullable().optional(),
  processingStatus: z
    .enum(["PENDING", "UPLOADING", "UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED"])
    .optional(),
  processingError: z.string().trim().max(5000).nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
  mediaFormat: z.string().trim().max(80).nullable().optional(),
  videoQuality: z.string().trim().max(80).nullable().optional(),
  audioTracks: z.unknown().nullable().optional(),
  published: z.boolean().default(false),
  publishedAt: nullableDateSchema,
  categoryId: uuidSchema,
  seasonId: z.string().trim().max(6).nullable().optional(),
  episodeNumber: z.number().int().min(1).max(99).nullable().optional(),
  episodeCode: z.string().trim().regex(/^[A-Z0-9]{6}$/).nullable().optional(),
});

const createVideoSchema = videoFields.extend({
  id: uuidSchema.optional(),
}).strict();
const updateVideoSchema = videoFields.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

router.get("/", async (req, res) => {
  const query = paginationSchema.extend({
    categoryId: uuidSchema.optional(),
    published: z.enum(["true", "false"]).optional(),
    processingStatus: z.enum(["PENDING", "UPLOADING", "UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED"]).optional(),
    source: z.enum(["originals"]).optional(),
  }).safeParse(req.query);

  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, categoryId, published, processingStatus, source } = query.data;
  const where = {
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
            { originalFileName: { contains: search, mode: "insensitive" as const } },
            { sourceObjectKey: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(published ? { published: published === "true" } : {}),
    ...(processingStatus ? { processingStatus } : {}),
    ...(source === "originals" ? { sourceObjectKey: { not: null } } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.video.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        season: { include: { program: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.video.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const video = await prisma.video.findUnique({
    where: { id: id.data },
    include: { category: true, season: { include: { program: true } } },
  });

  if (!video) return res.status(404).json({ error: "Video non trovato" });
  return res.json({ data: video });
});

router.post("/", async (req, res) => {
  const parsed = createVideoSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const input = parsed.data;
    if (input.published && !input.hlsUrl) {
      return res.status(409).json({ error: "Un video senza HLS non può essere pubblicato" });
    }

    if (!(await validateEpisodeAssignment(res, input.seasonId, input.episodeNumber))) return;
    const generatedEpisodeCode = await createEpisodeCode(input.seasonId, input.episodeNumber);
    if (input.episodeCode && generatedEpisodeCode && input.episodeCode !== generatedEpisodeCode) {
      return res.status(409).json({
        error: `ID episodio non coerente: per questa stagione/puntata deve essere ${generatedEpisodeCode}`,
      });
    }

    const video = await prisma.video.create({
      data: {
        ...input,
        ...(input.seasonId
          ? {
              categoryId: (
                await prisma.season.findUnique({
                  where: { id: input.seasonId },
                  select: { program: { select: { categoryId: true } } },
                })
              )?.program.categoryId ?? input.categoryId,
            }
          : {}),
        episodeCode: generatedEpisodeCode ?? input.episodeCode,
        publishedAt:
          input.published && !input.publishedAt ? new Date() : input.publishedAt,
      } as Prisma.VideoUncheckedCreateInput,
      include: { category: true, season: { include: { program: true } } },
    });
    return res.status(201).json({ data: video });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateVideoSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const input = parsed.data;
    const current = await prisma.video.findUnique({
      where: { id: id.data },
      select: { hlsUrl: true, seasonId: true, episodeNumber: true },
    });
    if (!current) return res.status(404).json({ error: "Video non trovato" });
    if (input.published === true) {
      if (!(input.hlsUrl ?? current.hlsUrl)) {
        return res.status(409).json({ error: "Un video senza HLS non può essere pubblicato" });
      }
    }
    const targetSeasonId = input.seasonId !== undefined ? input.seasonId : current.seasonId;
    const targetEpisodeNumber = input.episodeNumber !== undefined ? input.episodeNumber : current.episodeNumber;
    if (!(await validateEpisodeAssignment(res, targetSeasonId, targetEpisodeNumber, id.data))) return;
    const generatedEpisodeCode = await createEpisodeCode(targetSeasonId, targetEpisodeNumber);
    if (input.episodeCode && generatedEpisodeCode && input.episodeCode !== generatedEpisodeCode) {
      return res.status(409).json({
        error: `ID episodio non coerente: per questa stagione/puntata deve essere ${generatedEpisodeCode}`,
      });
    }

    const video = await prisma.video.update({
      where: { id: id.data },
      data: {
        ...input,
        ...(input.seasonId
          ? {
              categoryId: (
                await prisma.season.findUnique({
                  where: { id: input.seasonId },
                  select: { program: { select: { categoryId: true } } },
                })
              )?.program.categoryId ?? input.categoryId,
            }
          : {}),
        ...(input.seasonId !== undefined || input.episodeNumber !== undefined
          ? {
              episodeCode: generatedEpisodeCode ?? input.episodeCode ?? null,
            }
          : {}),
        ...(input.published === true && input.publishedAt === undefined
          ? { publishedAt: new Date() }
          : {}),
        ...(input.published === false && input.publishedAt === undefined
          ? { publishedAt: null }
          : {}),
      } as Prisma.VideoUncheckedUpdateInput,
      include: { category: true, season: { include: { program: true } } },
    });
    return res.json({ data: video });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const options = z.object({
    deleteFiles: z.enum(["true", "false"]).default("true"),
  }).safeParse(req.query);
  if (!id.success) return sendValidationError(res, id.error);
  if (!options.success) return sendValidationError(res, options.error, "Opzioni eliminazione non valide");

  try {
    const video = await prisma.video.findUnique({
      where: { id: id.data },
      select: {
        sourceObjectKey: true,
        convertedObjectKey: true,
        hlsUrl: true,
        thumbnailUrl: true,
      },
    });
    if (!video) return res.status(404).json({ error: "Video non trovato" });

    if (options.data.deleteFiles === "true") {
      const cleanup = await deleteVideoArchiveFiles(video);
      if (cleanup.errors.length) {
        return res.status(409).json({
          error: "Cancellazione file archivio non completata",
          details: cleanup.errors,
        });
      }
    }

    await prisma.video.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.post("/:id/transcode", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = z.object({
    sourcePath: z.string().trim().min(1).optional(),
  }).strict().safeParse(req.body ?? {});
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const video = await prisma.video.findUnique({
    where: { id: id.data },
    include: { category: { select: { name: true, slug: true } } },
  });
  if (!video) return res.status(404).json({ error: "Video non trovato" });
  if (!video.sourceObjectKey && !parsed.data.sourcePath) {
    return res.status(409).json({ error: "File sorgente non disponibile per la conversione" });
  }

  const inputRoot = process.env.WORKER_INPUT_ROOT ?? "/srv/tvmix/uploads";
  const sourcePath = parsed.data.sourcePath ?? `${inputRoot.replace(/\/+$/, "")}/${video.sourceObjectKey}`;
  const queue = getTranscodeQueue();
  const job = await queue.add(
    "transcode-hls",
    {
      videoId: video.id,
      sourcePath,
      sourceObjectKey: video.sourceObjectKey ?? undefined,
      title: video.title,
      slug: video.slug,
      description: video.description ?? undefined,
      thumbnailUrl: video.thumbnailUrl ?? undefined,
      categorySlug: video.category.slug,
      categoryName: video.category.name,
    },
    {
      jobId: `video-${video.id}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600, count: 5000 },
    },
  );

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { processingStatus: "QUEUED", processingError: null },
  });

  return res.status(202).json({
    ok: true,
    data: {
      jobId: job.id,
      videoId: video.id,
      sourcePath,
      processingStatus: updated.processingStatus,
    },
  });
});

router.get("/:id/transcode-status", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const video = await prisma.video.findUnique({
    where: { id: id.data },
    select: { id: true, processingStatus: true, processingError: true, duration: true },
  });
  if (!video) return res.status(404).json({ error: "Video non trovato" });

  const queue = getTranscodeQueue();
  const job = await queue.getJob(`video-${video.id}`);
  const state = job ? await job.getState() : null;
  return res.json({
    data: {
      videoId: video.id,
      processingStatus: video.processingStatus,
      processingError: video.processingError,
      duration: video.duration,
      jobId: job?.id ?? null,
      jobState: state,
      progress: job?.progress ?? null,
    },
  });
});

router.post("/:id/frame-grab", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = z.object({
    time: z.number().min(0).max(24 * 60 * 60),
  }).strict().safeParse(req.body ?? {});
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const video = await prisma.video.findUnique({
    where: { id: id.data },
    include: {
      category: true,
      season: { include: { program: true } },
    },
  });
  if (!video) return res.status(404).json({ error: "Video non trovato" });
  if (!video.sourceObjectKey) {
    return res.status(409).json({ error: "File originale R2 non disponibile per il frame grabber" });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), `tvmix-frame-${video.id}-`));
  const sourceExtension = path.extname(video.sourceObjectKey) || ".mp4";
  const sourcePath = path.join(workDir, `source${sourceExtension}`);
  const framePath = path.join(workDir, "frame.jpg");

  try {
    const source = await r2.send(new GetObjectCommand({
      Bucket: r2Config.bucket,
      Key: video.sourceObjectKey,
    }));
    if (!source.Body) throw new Error("Oggetto sorgente R2 vuoto");
    await pipeline(source.Body as NodeJS.ReadableStream, createWriteStream(sourcePath));

    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    await run(ffmpeg, [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-ss",
      String(parsed.data.time),
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath,
    ]);

    const fileName = safeFrameFileName(video.slug, parsed.data.time);
    const objectKey = r2Key(`thumbnails/${fileName}`);
    await r2.send(new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: objectKey,
      Body: createReadStream(framePath),
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: {
        "video-id": video.id,
        "frame-time": String(parsed.data.time),
      },
    }));

    const updated = await prisma.video.update({
      where: { id: video.id },
      data: { thumbnailUrl: `${r2Config.publicUrl}/${objectKey}` },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        season: { include: { program: true } },
      },
    });

    return res.status(201).json({
      data: updated,
      frame: {
        objectKey,
        publicUrl: updated.thumbnailUrl,
        time: parsed.data.time,
      },
    });
  } catch (error) {
    console.error("Frame grabber fallito", error);
    return res.status(502).json({ error: "Creazione frame grabber non riuscita" });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

export default router;
