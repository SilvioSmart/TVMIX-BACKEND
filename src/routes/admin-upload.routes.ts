import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
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
const slideContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const imageContentTypes = slideContentTypes;
const uploadScopes = ["video", "slide", "thumbnail", "locandina"] as const;
const multipartPartSize = 64 * 1024 * 1024;

function serializeUploadSession<T extends { size: bigint }>(session: T) {
  return { ...session, size: Number(session.size) };
}

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
    (value.scope === "slide" || value.scope === "thumbnail" || value.scope === "locandina") &&
    !imageContentTypes.includes(value.contentType as typeof imageContentTypes[number])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Per slide, thumbnail e locandine sono ammessi solo JPG, PNG, WebP o GIF",
    });
  }
  if (value.scope === "video" && !contentTypes.includes(value.contentType as typeof contentTypes[number])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Per i contenuti sono ammessi solo MP4, MOV o MKV",
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
        createdBy: res.locals.auth?.email,
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

    return res.json({
      status: "uploaded",
      uploadId: parsed.data.uploadId,
      objectKey: parsed.data.objectKey,
      publicUrl: `${r2Config.publicUrl}/${parsed.data.objectKey}`,
      originalFileName: parsed.data.fileName,
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

  try {
    const uploadedParts: Array<{ partNumber: number; etag: string; size?: number }> = [];
    let PartNumberMarker: string | undefined;
    do {
      const result = await r2.send(new ListPartsCommand({
        Bucket: r2Config.bucket,
        Key: session.objectKey,
        UploadId: session.multipartUploadId,
        PartNumberMarker,
      }));
      for (const part of result.Parts ?? []) {
        if (part.PartNumber && part.ETag) {
          uploadedParts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            ...(part.Size ? { size: part.Size } : {}),
          });
        }
      }
      PartNumberMarker = result.NextPartNumberMarker;
    } while (PartNumberMarker);

    const updated = await prisma.mediaUploadSession.update({
      where: { id: session.id },
      data: { uploadedParts },
    });

    return res.json({
      data: {
        ...updated,
        size: Number(updated.size),
        uploadId: updated.logicalUploadId,
        multipartUploadId: updated.multipartUploadId,
        expiresIn: r2Config.uploadUrlExpiresIn,
      },
    });
  } catch (error) {
    await prisma.mediaUploadSession.update({
      where: { id: session.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Resume failed",
      },
    }).catch(() => undefined);
    return res.status(409).json({ error: "Ripresa upload multipart non riuscita" });
  }
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
