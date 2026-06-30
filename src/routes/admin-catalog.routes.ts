import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { createProgramId, createSeasonId } from "../lib/catalog-id.js";
import {
  handlePrismaError,
  sendValidationError,
  slugSchema,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();
const programIdSchema = z.string().regex(/^[A-Z]{5}$/, "ID programma non valido");
const seasonIdSchema = z.string().regex(/^[A-Z]{3}S\d{2}$/, "ID stagione non valido");

const programSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slugSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: uuidSchema,
});

const seasonSchema = z.object({
  number: z.number().int().min(1).max(99),
  title: z.string().trim().max(160).nullable().optional(),
  programId: programIdSchema,
});

router.get("/tree", async (req, res) => {
  const search = z.string().trim().max(100).optional().safeParse(req.query.search);
  if (!search.success) return sendValidationError(res, search.error, "Ricerca non valida");

  const categories = await prisma.category.findMany({
    where: search.data
      ? {
          OR: [
            { name: { contains: search.data, mode: "insensitive" } },
            {
              programs: {
                some: {
                  OR: [
                    { name: { contains: search.data, mode: "insensitive" } },
                    {
                      seasons: {
                        some: {
                          episodes: {
                            some: {
                              title: { contains: search.data, mode: "insensitive" },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : undefined,
    include: {
      programs: {
        include: {
          seasons: {
            include: {
              episodes: {
                orderBy: { title: "asc" },
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  thumbnailUrl: true,
                  published: true,
                  processingStatus: true,
                },
              },
            },
            orderBy: { number: "asc" },
          },
        },
        orderBy: { name: "asc" },
      },
      _count: { select: { videos: true, programs: true } },
    },
    orderBy: { name: "asc" },
  });

  return res.json({ data: categories });
});

router.get("/episodes", async (req, res) => {
  const query = z.object({
    search: z.string().trim().max(100).optional(),
    unassigned: z.enum(["true", "false"]).default("true"),
  }).safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const data = await prisma.video.findMany({
    where: {
      ...(query.data.unassigned === "true" ? { seasonId: null } : {}),
      ...(query.data.search
        ? { title: { contains: query.data.search, mode: "insensitive" } }
        : {}),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      thumbnailUrl: true,
      seasonId: true,
      category: { select: { id: true, name: true } },
    },
    orderBy: { title: "asc" },
    take: 200,
  });
  return res.json({ data });
});

router.post("/programs", async (req, res) => {
  const parsed = programSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const program = await prisma.program.create({
      data: { id: createProgramId(parsed.data.name), ...parsed.data },
      include: { category: true },
    });
    return res.status(201).json({ data: program });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/programs/:id", async (req, res) => {
  const id = programIdSchema.safeParse(req.params.id);
  const parsed = programSchema.partial().strict().refine(
    (value) => Object.keys(value).length > 0,
    "Specificare almeno un campo da aggiornare",
  ).safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const program = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.program.update({
        where: { id: id.data },
        data: parsed.data,
        include: { category: true },
      });
      if (parsed.data.categoryId) {
        await transaction.video.updateMany({
          where: { season: { programId: id.data } },
          data: { categoryId: parsed.data.categoryId },
        });
      }
      return updated;
    });
    return res.json({ data: program });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/programs/:id", async (req, res) => {
  const id = programIdSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);
  try {
    await prisma.program.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.post("/seasons", async (req, res) => {
  const parsed = seasonSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    const season = await prisma.season.create({
      data: {
        id: createSeasonId(parsed.data.programId, parsed.data.number),
        ...parsed.data,
      },
      include: { program: true },
    });
    return res.status(201).json({ data: season });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/seasons/:id", async (req, res) => {
  const id = seasonIdSchema.safeParse(req.params.id);
  const parsed = z.object({
    title: z.string().trim().max(160).nullable().optional(),
  }).strict().safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    const season = await prisma.season.update({
      where: { id: id.data },
      data: parsed.data,
    });
    return res.json({ data: season });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.delete("/seasons/:id", async (req, res) => {
  const id = seasonIdSchema.safeParse(req.params.id);
  if (!id.success) return sendValidationError(res, id.error);
  try {
    await prisma.season.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.post("/seasons/:id/episodes", async (req, res) => {
  const id = seasonIdSchema.safeParse(req.params.id);
  const parsed = z.object({
    videoIds: z.array(uuidSchema).min(1).max(200),
  }).strict().safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const season = await prisma.season.findUnique({
    where: { id: id.data },
    select: { program: { select: { categoryId: true } } },
  });
  if (!season) return res.status(404).json({ error: "Stagione non trovata" });

  const result = await prisma.video.updateMany({
    where: { id: { in: parsed.data.videoIds } },
    data: { seasonId: id.data, categoryId: season.program.categoryId },
  });
  return res.json({ updated: result.count });
});

router.delete("/seasons/:seasonId/episodes/:videoId", async (req, res) => {
  const seasonId = seasonIdSchema.safeParse(req.params.seasonId);
  const videoId = uuidSchema.safeParse(req.params.videoId);
  if (!seasonId.success) return sendValidationError(res, seasonId.error);
  if (!videoId.success) return sendValidationError(res, videoId.error);
  try {
    await prisma.video.update({
      where: { id: videoId.data, seasonId: seasonId.data },
      data: { seasonId: null },
    });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
