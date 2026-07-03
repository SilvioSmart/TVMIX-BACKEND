import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  nullableDateSchema,
  optionalUrlSchema,
  paginationSchema,
  sendValidationError,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

const epgBaseSchema = z.object({
  liveStreamId: uuidSchema,
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(1000).nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  thumbnailUrl: optionalUrlSchema,
});

const epgSchema = epgBaseSchema.strict()
  .refine((value) => value.endsAt > value.startsAt, {
    message: "La fine programma deve essere successiva all'inizio",
    path: ["endsAt"],
  });

const updateEpgSchema = epgBaseSchema
  .extend({
    startsAt: nullableDateSchema,
    endsAt: nullableDateSchema,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Specificare almeno un campo da aggiornare")
  .refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, {
    message: "La fine programma deve essere successiva all'inizio",
    path: ["endsAt"],
  });

router.get("/", async (req, res) => {
  const query = paginationSchema
    .extend({
      liveStreamId: uuidSchema.optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, liveStreamId, from, to } = query.data;
  const where = {
    ...(liveStreamId ? { liveStreamId } : {}),
    ...(from ? { endsAt: { gte: from } } : {}),
    ...(to ? { startsAt: { lte: to } } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.liveEpgItem.findMany({
      where,
      include: { liveStream: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ startsAt: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.liveEpgItem.count({ where }),
  ]);

  return res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

router.post("/", async (req, res) => {
  const parsed = epgSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.liveEpgItem.create({ data: parsed.data });
    return res.status(201).json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateEpgSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.liveEpgItem.update({
      where: { id: id.data },
      data: parsed.data as Prisma.LiveEpgItemUncheckedUpdateInput,
    });
    return res.json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);

  try {
    await prisma.liveEpgItem.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
