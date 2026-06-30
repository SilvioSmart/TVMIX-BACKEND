import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
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

const videoFields = z.object({
  title: z.string().trim().min(2).max(200),
  slug: slugSchema,
  description: z.string().trim().max(5000).nullable().optional(),
  thumbnailUrl: optionalUrlSchema,
  hlsUrl: optionalUrlSchema,
  sourceObjectKey: z.string().trim().max(1000).nullable().optional(),
  originalFileName: z.string().trim().max(255).nullable().optional(),
  processingStatus: z
    .enum(["PENDING", "UPLOADING", "UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED"])
    .optional(),
  processingError: z.string().trim().max(5000).nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
  published: z.boolean().default(false),
  publishedAt: nullableDateSchema,
  categoryId: uuidSchema,
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
        publishedAt:
          input.published && !input.publishedAt ? new Date() : input.publishedAt,
      },
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
        ...(input.published === true && input.publishedAt === undefined
          ? { publishedAt: new Date() }
          : {}),
        ...(input.published === false && input.publishedAt === undefined
          ? { publishedAt: null }
          : {}),
      },
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

export default router;
