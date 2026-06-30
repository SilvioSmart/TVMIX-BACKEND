import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { z } from "zod";
import {
  r2,
  r2Config,
  r2Key,
  isOriginalObjectKey,
  verifyOriginalObject,
  verifyR2Bucket,
  verifyR2Object,
} from "../lib/r2.js";

const router = Router();
const contentTypes = ["video/mp4", "video/quicktime", "video/x-matroska"] as const;
const slideContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const uploadScopes = ["video", "slide"] as const;

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

const streamingUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.union([z.enum(contentTypes), z.enum(slideContentTypes)]),
  size: z.number().int().positive(),
  videoId: z.string().uuid().optional(),
  scope: z.enum(uploadScopes).default("video"),
}).superRefine((value, ctx) => {
  if (value.scope === "slide" && !slideContentTypes.includes(value.contentType as typeof slideContentTypes[number])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentType"],
      message: "Per le slide sono ammessi solo JPG, PNG, WebP o GIF",
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

  const videoExtensionByType = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
  } as const;
  const slideExtensionByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  } as const;
  const uploadId = parsed.data.videoId ?? randomUUID();
  const objectKey =
    parsed.data.scope === "slide"
      ? r2Key(
          `slide/${uploadId}/image.${
            slideExtensionByType[parsed.data.contentType as keyof typeof slideExtensionByType]
          }`,
        )
      : r2Key(
          `originals/${uploadId}/source.${
            videoExtensionByType[parsed.data.contentType as keyof typeof videoExtensionByType]
          }`,
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

  const extensionByType = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
  } as const;
  const uploadId = videoId ?? randomUUID();
  const objectKey = r2Key(
    `originals/${uploadId}/source.${extensionByType[contentType]}`,
  );
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
