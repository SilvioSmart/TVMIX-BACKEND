import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { r2, r2Config, r2Key, sanitizeR2FileName } from "../lib/r2.js";
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

function twoDigitUnitsTens(value: number) {
  const normalized = Math.abs(value) % 100;
  const units = normalized % 10;
  const tens = Math.floor(normalized / 10);
  return `${units}${tens}`;
}

async function createEpisodeCode(seasonId: string | null | undefined, episodeNumber: number | null | undefined) {
  if (!seasonId || !episodeNumber) return null;
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { number: true, programId: true },
  });
  if (!season) return null;

  const programId = season.programId.toUpperCase();
  return `${programId[0] ?? "X"}${programId.at(-1) ?? "X"}${twoDigitUnitsTens(season.number)}${twoDigitUnitsTens(episodeNumber)}`;
}

const videoFields = z.object({
  title: z.string().trim().min(2).max(200),
  slug: slugSchema.or(z.string().trim().regex(/^#[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug non valido")).transform(normalizeSlug),
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
  }).safeParse(req.query);

  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, categoryId, published } = query.data;
  const where = {
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(published ? { published: published === "true" } : {}),
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
        episodeCode:
          input.episodeCode ?? (await createEpisodeCode(input.seasonId, input.episodeNumber)),
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
    if (input.published === true) {
      const current = await prisma.video.findUnique({
        where: { id: id.data },
        select: { hlsUrl: true },
      });
      if (!current) return res.status(404).json({ error: "Video non trovato" });
      if (!(input.hlsUrl ?? current.hlsUrl)) {
        return res.status(409).json({ error: "Un video senza HLS non può essere pubblicato" });
      }
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
              episodeCode:
                input.episodeCode ??
                (await createEpisodeCode(
                  input.seasonId ??
                    (
                      await prisma.video.findUnique({
                        where: { id: id.data },
                        select: { seasonId: true },
                      })
                    )?.seasonId,
                  input.episodeNumber ??
                    (
                      await prisma.video.findUnique({
                        where: { id: id.data },
                        select: { episodeNumber: true },
                      })
                    )?.episodeNumber,
                )),
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
  if (!id.success) return sendValidationError(res, id.error);

  try {
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
