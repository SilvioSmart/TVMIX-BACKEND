import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUserDisplayName } from "../lib/auth-display.js";
import { deleteR2Objects, r2, r2Config, r2Key, sanitizeR2FileName, verifyR2Object } from "../lib/r2.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const router = Router();

const uuidSchema = z.string().uuid();
const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  published: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

const noticeSchema = z.object({
  category: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(180).optional(),
  excerpt: z.string().trim().max(260).nullable().optional(),
  body: z.string().trim().min(1),
  imageUrl: z.string().url(),
  imageObjectKey: z.string().trim().max(1024).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  published: z.boolean().default(false),
});

const tg9Schema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  videoUrl: z.string().url(),
  videoObjectKey: z.string().trim().max(1024).nullable().optional(),
  posterUrl: z.string().url().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  published: z.boolean().default(false),
});

const noticeImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || `news-${Date.now()}`;
}

async function uniqueNoticeSlug(base: string, excludeId?: string) {
  const normalized = slugify(base);
  let candidate = normalized;
  let suffix = 2;
  while (await prisma.noticeArticle.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } })) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function uniqueTg9Slug(base: string, excludeId?: string) {
  const normalized = slugify(base);
  let candidate = normalized;
  let suffix = 2;
  while (await prisma.tg9Video.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } })) {
    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function publishedAtFor(published: boolean, current?: Date | null) {
  if (!published) return null;
  return current ?? new Date();
}

function isR2PublicUrl(value: string) {
  return value.startsWith(`${r2Config.publicUrl}/`);
}

function noticeImageFileNameFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    const baseName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    return baseName && baseName.includes(".") ? baseName : `notice-image-${Date.now()}`;
  } catch {
    return `notice-image-${Date.now()}`;
  }
}

function extensionForNoticeImage(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return "";
}

async function normalizeNoticeImage(input: { imageUrl: string; imageObjectKey?: string | null }) {
  if (input.imageObjectKey || isR2PublicUrl(input.imageUrl)) return input;
  const remoteUrl = new URL(input.imageUrl);
  if (remoteUrl.protocol !== "http:" && remoteUrl.protocol !== "https:") {
    throw new Error("Sono consentiti solo URL immagine http o https");
  }

  const response = await fetch(remoteUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    headers: {
      accept: noticeImageTypes.join(", "),
      "user-agent": "TVMIX-NoticeImporter/1.0",
    },
  });
  if (!response.ok || !response.body) throw new Error(`Download immagine remota non riuscito (${response.status})`);

  const contentType = ((response.headers.get("content-type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (!noticeImageTypes.includes(contentType as typeof noticeImageTypes[number])) {
    throw new Error("Il file remoto non è un'immagine ammessa (JPG, PNG, WebP o GIF)");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength && contentLength > r2Config.maxUploadBytes) throw new Error("L'immagine remota supera la dimensione massima consentita");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("L'immagine remota è vuota");
  if (buffer.length > r2Config.maxUploadBytes) throw new Error("L'immagine remota supera la dimensione massima consentita");

  const requestedName = noticeImageFileNameFromUrl(input.imageUrl);
  const extension = pathExtension(requestedName) || extensionForNoticeImage(contentType);
  const safeFileName = sanitizeR2FileName(extension && requestedName.endsWith(extension) ? requestedName : `${requestedName}${extension}`);
  const objectKey = r2Key(`news/notice_slide/${safeFileName}`);
  await r2.send(new PutObjectCommand({
    Bucket: r2Config.bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      "original-name": encodeURIComponent(requestedName),
      "upload-source": "notice-external-url",
      "source-url": encodeURIComponent(input.imageUrl).slice(0, 1024),
    },
  }));
  await verifyR2Object(objectKey, buffer.length, contentType as typeof noticeImageTypes[number]);
  return { imageUrl: `${r2Config.publicUrl}/${objectKey}`, imageObjectKey: objectKey };
}

function pathExtension(fileName: string) {
  const match = /\.[a-z0-9]+$/i.exec(fileName);
  return match?.[0] ?? "";
}

router.get("/notice", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Filtri 9notice non validi" });
  const { search, published, limit } = parsed.data;
  const data = await prisma.noticeArticle.findMany({
    where: {
      ...(published ? { published: published === "true" } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
          { body: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
  return res.json({ data });
});

router.post("/notice", async (req, res) => {
  const parsed = noticeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati notizia non validi", details: parsed.error.flatten().fieldErrors });
  try {
    const createdBy = await currentUserDisplayName(res);
    const image = await normalizeNoticeImage({ imageUrl: parsed.data.imageUrl, imageObjectKey: parsed.data.imageObjectKey });
    const data = await prisma.noticeArticle.create({
      data: {
        ...parsed.data,
        imageUrl: image.imageUrl,
        imageObjectKey: image.imageObjectKey ?? null,
        slug: await uniqueNoticeSlug(parsed.data.slug || parsed.data.title),
        publishedAt: publishedAtFor(parsed.data.published),
        createdBy,
      },
    });
    return res.status(201).json({ data });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import immagine notizia non riuscito" });
  }
});

router.patch("/notice/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "ID notizia non valido" });
  const parsed = noticeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati notizia non validi", details: parsed.error.flatten().fieldErrors });
  const current = await prisma.noticeArticle.findUnique({ where: { id: id.data } });
  if (!current) return res.status(404).json({ error: "Notizia non trovata" });
  try {
    const nextPublished = parsed.data.published ?? current.published;
    const image = parsed.data.imageUrl
      ? await normalizeNoticeImage({ imageUrl: parsed.data.imageUrl, imageObjectKey: parsed.data.imageObjectKey })
      : null;
    const data = await prisma.noticeArticle.update({
      where: { id: id.data },
      data: {
        ...parsed.data,
        ...(image ? { imageUrl: image.imageUrl, imageObjectKey: image.imageObjectKey ?? null } : {}),
        ...(parsed.data.slug || parsed.data.title ? { slug: await uniqueNoticeSlug(parsed.data.slug || parsed.data.title || current.title, id.data) } : {}),
        ...(parsed.data.published !== undefined ? { publishedAt: publishedAtFor(nextPublished, current.publishedAt) } : {}),
      },
    });
    return res.json({ data });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Import immagine notizia non riuscito" });
  }
});

router.delete("/notice/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "ID notizia non valido" });
  const deleteFiles = req.query.deleteFiles === "true";
  const current = await prisma.noticeArticle.findUnique({ where: { id: id.data } });
  if (!current) return res.status(404).json({ error: "Notizia non trovata" });
  await prisma.noticeArticle.delete({ where: { id: id.data } });
  if (deleteFiles && current.imageObjectKey) await deleteR2Objects([current.imageObjectKey]);
  return res.status(204).send();
});

router.get("/tg9", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Filtri TG9 non validi" });
  const { search, published, limit } = parsed.data;
  const data = await prisma.tg9Video.findMany({
    where: {
      ...(published ? { published: published === "true" } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
  return res.json({ data });
});

router.post("/tg9", async (req, res) => {
  const parsed = tg9Schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati video TG9 non validi", details: parsed.error.flatten().fieldErrors });
  const createdBy = await currentUserDisplayName(res);
  const data = await prisma.tg9Video.create({
    data: {
      ...parsed.data,
      slug: await uniqueTg9Slug(parsed.data.slug || parsed.data.title),
      publishedAt: publishedAtFor(parsed.data.published),
      createdBy,
    },
  });
  return res.status(201).json({ data });
});

router.patch("/tg9/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "ID video TG9 non valido" });
  const parsed = tg9Schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati video TG9 non validi", details: parsed.error.flatten().fieldErrors });
  const current = await prisma.tg9Video.findUnique({ where: { id: id.data } });
  if (!current) return res.status(404).json({ error: "Video TG9 non trovato" });
  const nextPublished = parsed.data.published ?? current.published;
  const data = await prisma.tg9Video.update({
    where: { id: id.data },
    data: {
      ...parsed.data,
      ...(parsed.data.slug || parsed.data.title ? { slug: await uniqueTg9Slug(parsed.data.slug || parsed.data.title || current.title, id.data) } : {}),
      ...(parsed.data.published !== undefined ? { publishedAt: publishedAtFor(nextPublished, current.publishedAt) } : {}),
    },
  });
  return res.json({ data });
});

router.delete("/tg9/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "ID video TG9 non valido" });
  const deleteFiles = req.query.deleteFiles === "true";
  const current = await prisma.tg9Video.findUnique({ where: { id: id.data } });
  if (!current) return res.status(404).json({ error: "Video TG9 non trovato" });
  await prisma.tg9Video.delete({ where: { id: id.data } });
  if (deleteFiles && current.videoObjectKey) await deleteR2Objects([current.videoObjectKey]);
  return res.status(204).send();
});

export default router;
