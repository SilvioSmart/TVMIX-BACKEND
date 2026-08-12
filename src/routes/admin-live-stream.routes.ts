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

const liveStreamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  streamType: z.enum(["LIVE_STREAMING", "PLAYLIST"]).default("LIVE_STREAMING"),
  hlsUrl: z.string().trim().url(),
  status: z.enum(["OFFLINE", "LIVE", "SCHEDULED"]).default("OFFLINE"),
  posterUrl: optionalUrlSchema,
  vastUrl: optionalUrlSchema,
  startedAt: nullableDateSchema,
  endedAt: nullableDateSchema,
});

const updateLiveStreamSchema = liveStreamSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

router.get("/", async (req, res) => {
  const query = paginationSchema.extend({
    status: z.enum(["OFFLINE", "LIVE", "SCHEDULED"]).optional(),
  }).safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, status } = query.data;
  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.liveStream.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.liveStream.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  const stream = await prisma.liveStream.findUnique({ where: { id: id.data } });
  if (!stream) return res.status(404).json({ error: "Canale live non trovato" });
  return res.json({ data: stream });
});

router.post("/", async (req, res) => {
  const parsed = liveStreamSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const stream = await prisma.liveStream.create({ data: parsed.data });
    return res.status(201).json({ data: stream });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateLiveStreamSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const stream = await prisma.liveStream.update({
      where: { id: id.data },
      data: parsed.data,
    });
    return res.json({ data: stream });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  try {
    await prisma.liveStream.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
