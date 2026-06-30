import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  paginationSchema,
  sendValidationError,
  slugSchema,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: slugSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

const updateCategorySchema = categorySchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

router.get("/", async (req, res) => {
  const query = paginationSchema.safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search } = query.data;
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { slug: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [data, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      include: { _count: { select: { videos: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.category.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const category = await prisma.category.findUnique({
    where: { id: id.data },
    include: { _count: { select: { videos: true } } },
  });

  if (!category) return res.status(404).json({ error: "Categoria non trovata" });
  return res.json({ data: category });
});

router.post("/", async (req, res) => {
  const parsed = categorySchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const category = await prisma.category.create({ data: parsed.data });
    return res.status(201).json({ data: category });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const category = await prisma.category.update({
      where: { id: id.data },
      data: parsed.data,
    });
    return res.json({ data: category });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  try {
    await prisma.category.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
