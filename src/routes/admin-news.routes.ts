import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentUserDisplayName } from "../lib/auth-display.js";
import { deleteR2Objects } from "../lib/r2.js";

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
  const createdBy = await currentUserDisplayName(res);
  const data = await prisma.noticeArticle.create({
    data: {
      ...parsed.data,
      slug: await uniqueNoticeSlug(parsed.data.slug || parsed.data.title),
      publishedAt: publishedAtFor(parsed.data.published),
      createdBy,
    },
  });
  return res.status(201).json({ data });
});

router.patch("/notice/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "ID notizia non valido" });
  const parsed = noticeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati notizia non validi", details: parsed.error.flatten().fieldErrors });
  const current = await prisma.noticeArticle.findUnique({ where: { id: id.data } });
  if (!current) return res.status(404).json({ error: "Notizia non trovata" });
  const nextPublished = parsed.data.published ?? current.published;
  const data = await prisma.noticeArticle.update({
    where: { id: id.data },
    data: {
      ...parsed.data,
      ...(parsed.data.slug || parsed.data.title ? { slug: await uniqueNoticeSlug(parsed.data.slug || parsed.data.title || current.title, id.data) } : {}),
      ...(parsed.data.published !== undefined ? { publishedAt: publishedAtFor(nextPublished, current.publishedAt) } : {}),
    },
  });
  return res.json({ data });
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
