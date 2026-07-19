import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUserDisplayName } from "../lib/auth-display.js";
import {
  r2,
  r2Config,
  r2Key,
  isOriginalObjectKey,
  sanitizeR2FileName,
  verifyOriginalObject,
  verifyR2Bucket,
  verifyR2Object,
} from "../lib/r2.js";

const router = Router();
const contentTypes = ["video/mp4", "video/quicktime", "video/x-matroska"] as const;
const extensionContentType: Record<string, typeof contentTypes[number]> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};
const slideContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const imageContentTypes = slideContentTypes;
const uploadScopes = ["video", "slide", "thumbnail", "locandina", "notice_slide", "tg9_video"] as const;
const multipartPartSize = 64 * 1024 * 1024;

function serializeUploadSession<T extends { size: bigint }>(session: T) {
  return { ...session, size: Number(session.size) };
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || `media-${Date.now()}`;
}

async function uniqueVideoSlug(base: string): Promise<string> {
  const normalized = slugify(base);
  let candidate = normalized;
  let suffix = 2;
  while (await prisma.video.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function loadingCategoryId(): Promise<string> {
  const category = await prisma.category.upsert({
    where: { slug: "loading" },
    create: {
      name: "Loading",
      slug: "loading",
      description: "Area tecnica per media caricati in archivio e non ancora catalogati",
    },
    update: {},
    select: { id: true },
  });
  return category.id;
}

async function registerCompletedOriginal(input: {
  logicalUploadId?: string;
  objectKey: string;
  fileName: string;
  contentType: typeof contentTypes[number];
  size?: number;
  uploadedBy?: string | null;
}) {
  const existingBySource = await prisma.video.findFirst({
    where: { sourceObjectKey: input.objectKey },
    include: { category: true, season: { include: { program: true } } },
  });
  if (existingBySource) return existingBySource;

  if (input.logicalUploadId) {
    const existingById = await prisma.video.findUnique({
      where: { id: input.logicalUploadId },
      include: { category: true, season: { include: { program: true } } },
    }).catch(() => null);
    if (existingById) return existingById;
  }

  const title = path.parse(input.fileName).name;
  return prisma.video.create({
    data: {
      title,
      slug: await uniqueVideoSlug(title),
      categoryId: await loadingCategoryId(),
      sourceObjectKey: input.objectKey,
      originalFileName: input.fileName,
      uploadedBy: input.uploadedBy ?? null,
      processingStatus: "UPLOADED",
      processingError: null,
      mediaFormat: input.contentType,
      published: false,
    },
    include: { category: true, season: { include: { program: true } } },
  });
}

function remoteImportRoot() {
  return path.resolve(process.env.MEDIA_IMPORT_ROOT ?? "/srv/tvmix/imports");
}

function safeRemotePath(input: string) {
  const root = remoteImportRoot();
  const resolved = path.resolve(root, input.replace(/^[/\\]+/, ""));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Percorso remoto fuori dalla cartella import consentita");
  }
  return resolved;
}

function mediaContentTypeForFile(fileName: string) {
  return extensionContentType[path.extname(fileName).toLowerCase()] ?? null;
}

function ffprobe(filePath: string): Promise<{
  duration?: number;
  videoQuality?: string;
  mediaFormat?: string;
  audioTracks?: Array<{ codec?: string; channels?: number; layout?: string }>;
  fps?: number;
}> {
  const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
  return new Promise((resolve) => {
    const child = spawn(ffprobePath, [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => resolve({ mediaFormat: path.extname(filePath).slice(1).toUpperCase() }));
    child.on("close", () => {
      try {
        const payload = JSON.parse(stdout) as {
          format?: { duration?: string; format_name?: string };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            r_frame_rate?: string;
            channels?: number;
            channel_layout?: string;
          }>;
        };
        const video = payload.streams?.find((stream) => stream.codec_type === "video");
        const audio = payload.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
        const [fpsNum, fpsDen] = (video?.r_frame_rate ?? "").split("/").map(Number);
        resolve({
          duration: payload.format?.duration ? Math.round(Number(payload.format.duration)) : undefined,
          videoQuality: video?.width && video.height ? `${video.width}x${video.height}` : undefined,
          mediaFormat: payload.format?.format_name ?? path.extname(filePath).slice(1).toUpperCase(),
          fps: fpsNum && fpsDen ? Math.round((fpsNum / fpsDen) * 100) / 100 : undefined,
          audioTracks: audio.map((track) => ({
            codec: track.codec_name,
            channels: track.channels,
            layout: track.channel_layout,
          })),
        });
      } catch {
        resolve({ mediaFormat: path.extname(filePath).slice(1).toUpperCase() });
      }
    });
  });
}

const registerOriginalSchema = z.object({
  objectKey: z.string().min(1).max(1024),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(contentTypes),
  size: z.number().int().positive(),
  duration: z.number().int().positive().nullable().optional(),
  mediaFormat: z.string().trim().max(80).nullable().optional(),
  videoQuality: z.string().trim().max(80).nullable().optional(),
  audioTracks: z.unknown().nullable().optional(),
});

const remoteListSchema = z.object({
  path: z.string().trim().max(500).default(""),
});

const remoteImportSchema = z.object({
  path: z.string().trim().min(1).max(1000),
});

const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(contentTypes),
  size: z.number().int().positive(),
  videoId: z.string().uuid().optional(),
});

const completeSchema = z.object({
  objectKey: z.string().min(1).max(1024),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(contentTypes),
  size: z.number().int().positive(),
});

const multipartCreateSchema = presignSchema;

const multipartPartSchema = z.object({
  uploadId: z.string().min(1).max(2048),
  objectKey: z.string().min(1).max(1024),
  partNumber: z.coerce.number().int().min(1).max(10_000),
  size: z.coerce.number().int().positive().max(multipartPartSize).optional(),
});

const multipartCompleteSchema = completeSchema.extend({
  uploadId: z.string().min(1).max(2048),
  parts: z.array(
    z.object({
      partNumber: z.number().int().min(1).max(10_000),
      etag: z.string().min(1),
    }),
  ).min(1).max(10_000),
});

const multipartAbortSchema = z.object({
  uploadId: z.string().min(1).max(2048),
  objectKey: z.string().min(1).max(1024),
});

const multipartResumeSchema = z.object({
  logicalUploadId: z.string().uuid(),
});

const streamingUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.union([z.enum(contentTypes), z.enum(imageContentTypes)]),
  size: z.number().int().positive(),
  videoId: z.string().uuid().optional(),
  scope: z.enum(uploadScopes).default("video"),
}).superRefine((value, ctx) => {
  if (
    (value.scope === "slide" || value.scope === "thumbnail" || value.scope === "locandina" || value.scope === "notice_slide") &&
    !imageContentTypes.includes(value.contentType as typeof imageContentTypes[number])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Per slide, thumbnail, locandine e immagini news sono ammessi solo JPG, PNG, WebP o GIF",
    });
  }
  if ((value.scope === "video" || value.scope === "tg9_video") && !contentTypes.includes(value.contentType as typeof contentTypes[number])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Per i contenuti video sono ammessi solo MP4, MOV o MKV",
    });
  }
});

router.get("/status", async (_req, res) => {
  try {
    await verifyR2Bucket();
    return res.json({
      status: "ok",
      bucket: r2Config.bucket,
      prefix: r2Config.prefix,
      publicUrl: r2Config.publicUrl,
    });
  } catch {
    return res.status(503).json({ error: "Connessione Cloudflare R2 non disponibile" });
  }
});

router.get("/remote-files", async (req, res) => {
  const parsed = remoteListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Percorso remoto non valido" });

  try {
    const directory = safeRemotePath(parsed.data.path);
    const entries = await readdir(directory, { withFileTypes: true });
    const data = await Promise.all(entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(remoteImportRoot(), absolute).split(path.sep).join("/");
      const itemStat = await stat(absolute);
      return {
        name: entry.name,
        path: relative,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? itemStat.size : null,
        supported: entry.isFile() ? Boolean(mediaContentTypeForFile(entry.name)) : true,
        updatedAt: itemStat.mtime.toISOString(),
      };
    }));
    return res.json({
      root: remoteImportRoot(),
      path: path.relative(remoteImportRoot(), directory).split(path.sep).join("/"),
      data: data.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1),
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Lettura cartella remota non riuscita" });
  }
});

router.post("/register-original", async (req, res) => {
  const parsed = registerOriginalSchema.strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati media originale non validi", details: parsed.error.flatten().fieldErrors });
  if (!isOriginalObjectKey(parsed.data.objectKey)) return res.status(400).json({ error: "Chiave oggetto R2 non valida" });

  try {
    await verifyOriginalObject(parsed.data.objectKey, parsed.data.size, parsed.data.contentType);
    const duplicate = await prisma.video.findFirst({
      where: {
        OR: [
          { sourceObjectKey: parsed.data.objectKey },
          { originalFileName: parsed.data.fileName, processingStatus: { in: ["UPLOADED", "QUEUED", "PROCESSING", "READY"] } },
        ],
      },
      select: { id: true, title: true, sourceObjectKey: true },
    });
    if (duplicate) {
      if (duplicate.sourceObjectKey === parsed.data.objectKey) {
        const existing = await prisma.video.findUnique({
          where: { id: duplicate.id },
          include: { category: true, season: { include: { program: true } } },
        });
        return res.status(200).json({ data: existing });
      }
      return res.status(409).json({ error: `File già presente in archivio: ${duplicate.title}`, data: duplicate });
    }

    const uploadedBy = await currentUserDisplayName(res);
    const video = await registerCompletedOriginal({
      objectKey: parsed.data.objectKey,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      uploadedBy,
    });
    const updated = await prisma.video.update({
      where: { id: video.id },
      data: {
        duration: parsed.data.duration ?? video.duration,
        mediaFormat: parsed.data.mediaFormat ?? video.mediaFormat ?? parsed.data.contentType,
        videoQuality: parsed.data.videoQuality ?? video.videoQuality,
        audioTracks: parsed.data.audioTracks ?? undefined,
      },
      include: { category: true, season: { include: { program: true } } },
    });
    return res.status(201).json({ data: updated });
  } catch (error) {
    console.error("Registrazione originale fallita", error);
    return res.status(409).json({ error: error instanceof Error ? error.message : "Registrazione media non riuscita" });
  }
});

router.post("/remote-import", async (req, res) => {
  const parsed = remoteImportSchema.strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati import remoto non validi" });

  try {
    const sourcePath = safeRemotePath(parsed.data.path);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) return res.status(400).json({ error: "Il percorso remoto non è un file" });
    const contentType = mediaContentTypeForFile(sourcePath);
    if (!contentType) return res.status(400).json({ error: "Sono ammessi solo file MP4, MOV o MKV" });

    const fileName = path.basename(sourcePath);
    const safeFileName = sanitizeR2FileName(fileName);
    const objectKey = r2Key(`originals/${safeFileName}`);
    const duplicate = await prisma.video.findFirst({
      where: {
        OR: [
          { sourceObjectKey: objectKey },
          { originalFileName: fileName, processingStatus: { in: ["UPLOADED", "QUEUED", "PROCESSING", "READY"] } },
        ],
      },
      select: { id: true, title: true, sourceObjectKey: true },
    });
    if (duplicate) return res.status(409).json({ error: `File già presente in archivio: ${duplicate.title}`, data: duplicate });

    const metadata = await ffprobe(sourcePath);
    const upload = new Upload({
      client: r2,
      params: {
        Bucket: r2Config.bucket,
        Key: objectKey,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
        Metadata: {
          "original-name": encodeURIComponent(fileName),
          "upload-id": randomUUID(),
        },
      },
      queueSize: 4,
      partSize: 64 * 1024 * 1024,
      leavePartsOnError: true,
    });
    await upload.done();
    await verifyOriginalObject(objectKey, sourceStat.size, contentType);

    const uploadedBy = await currentUserDisplayName(res);
    const title = path.parse(fileName).name;
    const video = await prisma.video.create({
      data: {
        title,
        slug: await uniqueVideoSlug(title),
        categoryId: await loadingCategoryId(),
        sourceObjectKey: objectKey,
        originalFileName: fileName,
        uploadedBy,
        processingStatus: "UPLOADED",
        duration: metadata.duration ?? null,
        mediaFormat: metadata.mediaFormat ?? contentType,
        videoQuality: metadata.videoQuality ? `${metadata.videoQuality}${metadata.fps ? ` · ${metadata.fps} fps` : ""}` : null,
        audioTracks: metadata.audioTracks ?? undefined,
        published: false,
      },
      include: { category: true, season: { include: { program: true } } },
    });
    return res.status(201).json({ data: video, metadata, objectKey });
  } catch (error) {
    console.error("Import remoto originale fallito", error);
    return res.status(409).json({ error: error instanceof Error ? error.message : "Import remoto non riuscito" });
  }
});

router.post("/file", async (req, res) => {
  let decodedFileName = "";
  try {
    decodedFileName = decodeURIComponent(req.header("x-file-name") ?? "");
  } catch {
    return res.status(400).json({ error: "Nome file non valido" });
  }

  const parsed = streamingUploadSchema.safeParse({
    fileName: decodedFileName,
    contentType: req.header("content-type"),
    size: Number(req.header("content-length")),
    videoId: req.header("x-video-id") || undefined,
    scope: req.header("x-upload-scope") || "video",
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "Dati upload non validi" });
  }

  if (parsed.data.size > r2Config.maxUploadBytes) {
    return res.status(413).json({ error: "Il file supera la dimensione massima consentita" });
  }

  const uploadId = parsed.data.videoId ?? randomUUID();
  const safeFileName = sanitizeR2FileName(parsed.data.fileName);
  const objectKey = r2Key(
    parsed.data.scope === "slide"
      ? `slide/${safeFileName}`
      : parsed.data.scope === "thumbnail"
        ? `thumbnails/${safeFileName}`
        : parsed.data.scope === "locandina"
          ? `locandine/${safeFileName}`
          : parsed.data.scope === "notice_slide"
            ? `news/notice_slide/${safeFileName}`
            : parsed.data.scope === "tg9_video"
              ? `news/tg9_video/${safeFileName}`
              : `originals/${safeFileName}`,
  );

  try {
    const upload = new Upload({
      client: r2,
      params: {
        Bucket: r2Config.bucket,
        Key: objectKey,
        Body: req,
        ContentType: parsed.data.contentType,
        Metadata: {
          "original-name": encodeURIComponent(parsed.data.fileName),
          "upload-id": uploadId,
        },
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();
    await verifyR2Object(objectKey, parsed.data.size, parsed.data.contentType);

    return res.status(201).json({
      status: "uploaded",
      uploadId,
      objectKey,
      publicUrl: `${r2Config.publicUrl}/${objectKey}`,
      originalFileName: parsed.data.fileName,
    });
  } catch (error) {
    console.error("Upload R2 streaming fallito", error);
    return res.status(502).json({ error: "Caricamento del file su R2 non riuscito" });
  }
});

router.post("/multipart/create", async (req, res) => {
  const parsed = multipartCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati upload multipart non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { fileName, contentType, size, videoId } = parsed.data;
  if (size > r2Config.maxUploadBytes) {
    return res.status(413).json({ error: "Il file supera la dimensione massima consentita" });
  }

  const logicalUploadId = videoId ?? randomUUID();
  const objectKey = r2Key(`originals/${sanitizeR2FileName(fileName)}`);

  try {
    const existing = await prisma.mediaUploadSession.findUnique({
      where: { logicalUploadId },
    });
    if (existing?.status === "IN_PROGRESS") {
      return res.status(200).json({
        uploadId: existing.logicalUploadId,
        multipartUploadId: existing.multipartUploadId,
        objectKey: existing.objectKey,
        partSize: existing.partSize,
        totalParts: existing.totalParts,
        uploadedParts: existing.uploadedParts,
        size: Number(existing.size),
        expiresIn: r2Config.uploadUrlExpiresIn,
        resumable: true,
      });
    }

    const created = await r2.send(
      new CreateMultipartUploadCommand({
        Bucket: r2Config.bucket,
        Key: objectKey,
        ContentType: contentType,
        Metadata: {
          "original-name": encodeURIComponent(fileName),
          "upload-id": logicalUploadId,
        },
      }),
    );

    if (!created.UploadId) {
      return res.status(502).json({ error: "R2 non ha restituito un ID multipart valido" });
    }

    await prisma.mediaUploadSession.upsert({
      where: { logicalUploadId },
      create: {
        logicalUploadId,
        multipartUploadId: created.UploadId,
        objectKey,
        fileName,
        contentType,
        size: BigInt(size),
        partSize: multipartPartSize,
        totalParts: Math.ceil(size / multipartPartSize),
        createdBy: await currentUserDisplayName(res),
      },
      update: {
        multipartUploadId: created.UploadId,
        objectKey,
        fileName,
        contentType,
        size: BigInt(size),
        partSize: multipartPartSize,
        totalParts: Math.ceil(size / multipartPartSize),
        uploadedParts: [],
        status: "IN_PROGRESS",
        error: null,
        completedAt: null,
        abortedAt: null,
      },
    });

    return res.status(201).json({
      uploadId: logicalUploadId,
      multipartUploadId: created.UploadId,
      objectKey,
      partSize: multipartPartSize,
      totalParts: Math.ceil(size / multipartPartSize),
      expiresIn: r2Config.uploadUrlExpiresIn,
    });
  } catch (error) {
    console.error("Creazione multipart R2 fallita", error);
    return res.status(502).json({ error: "Creazione upload multipart non riuscita" });
  }
});

router.post("/multipart/part", async (req, res) => {
  const parsed = multipartPartSchema.safeParse({
    uploadId: req.header("x-multipart-upload-id"),
    objectKey: req.header("x-object-key"),
    partNumber: req.header("x-part-number"),
    size: req.header("content-length") || undefined,
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "Dati parte multipart non validi" });
  }

  try {
    const uploaded = await r2.send(
      new UploadPartCommand({
        Bucket: r2Config.bucket,
        Key: parsed.data.objectKey,
        UploadId: parsed.data.uploadId,
        PartNumber: parsed.data.partNumber,
        Body: req,
        ...(parsed.data.size ? { ContentLength: parsed.data.size } : {}),
      }),
    );

    if (!uploaded.ETag) {
      return res.status(502).json({ error: "R2 non ha restituito l'ETag della parte" });
    }

    const session = await prisma.mediaUploadSession.findFirst({
      where: {
        multipartUploadId: parsed.data.uploadId,
        objectKey: parsed.data.objectKey,
        status: "IN_PROGRESS",
      },
    });
    if (session) {
      const current = Array.isArray(session.uploadedParts)
        ? session.uploadedParts as Array<{ partNumber: number; etag: string; size?: number }>
        : [];
      const next = [
        ...current.filter((part) => part.partNumber !== parsed.data.partNumber),
        {
          partNumber: parsed.data.partNumber,
          etag: uploaded.ETag,
          ...(parsed.data.size ? { size: parsed.data.size } : {}),
        },
      ].sort((a, b) => a.partNumber - b.partNumber);
      await prisma.mediaUploadSession.update({
        where: { id: session.id },
        data: { uploadedParts: next },
      });
    }

    return res.status(201).json({
      partNumber: parsed.data.partNumber,
      etag: uploaded.ETag,
    });
  } catch (error) {
    console.error("Upload parte multipart R2 fallito", error);
    return res.status(502).json({ error: "Caricamento parte multipart non riuscito" });
  }
});

router.post("/multipart/complete", async (req, res) => {
  const parsed = multipartCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati completamento multipart non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  if (!isOriginalObjectKey(parsed.data.objectKey)) {
    return res.status(400).json({ error: "Chiave oggetto R2 non valida" });
  }

  try {
    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: r2Config.bucket,
        Key: parsed.data.objectKey,
        UploadId: parsed.data.uploadId,
        MultipartUpload: {
          Parts: parsed.data.parts
            .map((part) => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            }))
            .sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)),
        },
      }),
    );

    await verifyOriginalObject(
      parsed.data.objectKey,
      parsed.data.size,
      parsed.data.contentType,
    );

    await prisma.mediaUploadSession.updateMany({
      where: {
        multipartUploadId: parsed.data.uploadId,
        objectKey: parsed.data.objectKey,
      },
      data: {
        status: "COMPLETED",
        uploadedParts: parsed.data.parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
        })),
        error: null,
        completedAt: new Date(),
      },
    });
    const session = await prisma.mediaUploadSession.findFirst({
      where: {
        multipartUploadId: parsed.data.uploadId,
        objectKey: parsed.data.objectKey,
      },
    });
    const video = await registerCompletedOriginal({
      logicalUploadId: session?.logicalUploadId,
      objectKey: parsed.data.objectKey,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      uploadedBy: session?.createdBy ?? await currentUserDisplayName(res),
    });

    return res.json({
      status: "uploaded",
      uploadId: parsed.data.uploadId,
      objectKey: parsed.data.objectKey,
      publicUrl: `${r2Config.publicUrl}/${parsed.data.objectKey}`,
      originalFileName: parsed.data.fileName,
      video,
    });
  } catch (error) {
    console.error("Completamento multipart R2 fallito", error);
    await prisma.mediaUploadSession.updateMany({
      where: {
        multipartUploadId: parsed.data.uploadId,
        objectKey: parsed.data.objectKey,
      },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Complete failed",
      },
    }).catch(() => undefined);
    return res.status(409).json({ error: "Completamento upload multipart non riuscito" });
  }
});

router.get("/multipart/sessions", async (req, res) => {
  const query = z.object({
    status: z.enum(["IN_PROGRESS", "COMPLETED", "ABORTED", "FAILED"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Filtri upload non validi" });

  const data = await prisma.mediaUploadSession.findMany({
    where: query.data.status ? { status: query.data.status } : undefined,
    orderBy: { updatedAt: "desc" },
    take: query.data.limit,
  });
  return res.json({ data: data.map(serializeUploadSession) });
});

router.post("/multipart/resume", async (req, res) => {
  const parsed = multipartResumeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati ripresa multipart non validi" });

  const session = await prisma.mediaUploadSession.findUnique({
    where: { logicalUploadId: parsed.data.logicalUploadId },
  });
  if (!session) return res.status(404).json({ error: "Sessione upload non trovata" });
  if (session.status !== "IN_PROGRESS") {
    return res.status(409).json({ error: `Upload non riprendibile: ${session.status}` });
  }

  return res.json({
    data: {
      ...serializeUploadSession(session),
      uploadId: session.logicalUploadId,
      multipartUploadId: session.multipartUploadId,
      expiresIn: r2Config.uploadUrlExpiresIn,
      r2Check: "database",
    },
  });
});

router.post("/multipart/abort", async (req, res) => {
  const parsed = multipartAbortSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dati annullamento multipart non validi" });
  }

  try {
    await r2.send(
      new AbortMultipartUploadCommand({
        Bucket: r2Config.bucket,
        Key: parsed.data.objectKey,
        UploadId: parsed.data.uploadId,
      }),
    );
    await prisma.mediaUploadSession.updateMany({
      where: {
        multipartUploadId: parsed.data.uploadId,
        objectKey: parsed.data.objectKey,
      },
      data: {
        status: "ABORTED",
        abortedAt: new Date(),
      },
    });
    return res.status(204).send();
  } catch (error) {
    console.error("Annullamento multipart R2 fallito", error);
    return res.status(502).json({ error: "Annullamento upload multipart non riuscito" });
  }
});

router.post("/presign", async (req, res) => {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati upload non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { fileName, contentType, size, videoId } = parsed.data;
  if (size > r2Config.maxUploadBytes) {
    return res.status(413).json({ error: "Il file supera la dimensione massima consentita" });
  }

  const uploadId = videoId ?? randomUUID();
  const objectKey = r2Key(`originals/${sanitizeR2FileName(fileName)}`);
  const command = new PutObjectCommand({
    Bucket: r2Config.bucket,
    Key: objectKey,
    ContentType: contentType,
    Metadata: {
      "original-name": encodeURIComponent(fileName),
      "upload-id": uploadId,
    },
  });
  const uploadUrl = await getSignedUrl(r2, command, {
    expiresIn: r2Config.uploadUrlExpiresIn,
  });

  return res.status(201).json({
    uploadId,
    objectKey,
    uploadUrl,
    expiresIn: r2Config.uploadUrlExpiresIn,
    requiredHeaders: { "Content-Type": contentType },
  });
});

router.post("/complete", async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Dati completamento upload non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  if (!isOriginalObjectKey(parsed.data.objectKey)) {
    return res.status(400).json({ error: "Chiave oggetto R2 non valida" });
  }

  try {
    await verifyOriginalObject(
      parsed.data.objectKey,
      parsed.data.size,
      parsed.data.contentType,
    );
    return res.json({
      status: "uploaded",
      objectKey: parsed.data.objectKey,
      originalFileName: parsed.data.fileName,
    });
  } catch {
    return res.status(409).json({ error: "Upload R2 non verificato" });
  }
});

export default router;
