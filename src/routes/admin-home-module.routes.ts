import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  paginationSchema,
  sendValidationError,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

const nullableUuidSchema = z
  .union([uuidSchema, z.literal(""), z.null()])
  .transform((value) => value || null)
  .optional();

const nullableCatalogIdSchema = z
  .union([z.string().trim().min(1).max(12), z.literal(""), z.null()])
  .transform((value) => value || null)
  .optional();

const moduleSchema = z.object({
  title: z.string().trim().min(2).max(140),
  subtitle: z.string().trim().max(240).nullable().optional(),
  type: z.enum(["CAROUSEL_SLIDER", "LIVE_EPG", "POSTER_RAIL", "PROMOTIONS"]),
  queryType: z.enum(["LATEST", "CATEGORY", "PROGRAM", "SEASON", "MANUAL", "LIVE"]).default("LATEST"),
  sortMethod: z.enum(["RECENT", "OLDEST", "TITLE_ASC"]).default("RECENT"),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  enabled: z.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  categoryId: nullableUuidSchema,
  programId: nullableCatalogIdSchema,
  seasonId: nullableCatalogIdSchema,
  liveStreamId: nullableUuidSchema,
  videoIds: z.array(uuidSchema).max(100).optional(),
});

const updateModuleSchema = moduleSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

function moduleData(input: z.infer<typeof moduleSchema> | z.infer<typeof updateModuleSchema>) {
  const { videoIds: _videoIds, ...data } = input;
  return data;
}

async function replaceModuleItems(moduleId: string, videoIds?: string[]) {
  if (!videoIds) return;

  await prisma.$transaction([
    prisma.homeModuleItem.deleteMany({ where: { moduleId } }),
    ...videoIds.map((videoId, index) =>
      prisma.homeModuleItem.create({
        data: { moduleId, videoId, sortOrder: (index + 1) * 10 },
      }),
    ),
  ]);
}

router.get("/", async (req, res) => {
  const query = paginationSchema
    .extend({
      type: z.enum(["CAROUSEL_SLIDER", "LIVE_EPG", "POSTER_RAIL", "PROMOTIONS"]).optional(),
      enabled: z.coerce.boolean().optional(),
    })
    .safeParse(req.query);
  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, type, enabled } = query.data;
  const where = {
    ...(type ? { type } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.homeModule.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        program: { select: { id: true, name: true, slug: true } },
        season: { select: { id: true, number: true, title: true } },
        liveStream: { select: { id: true, name: true, slug: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          select: { videoId: true, sortOrder: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.homeModule.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.post("/", async (req, res) => {
  const parsed = moduleSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.homeModule.create({
      data: moduleData(parsed.data) as Prisma.HomeModuleUncheckedCreateInput,
    });
    await replaceModuleItems(data.id, parsed.data.videoIds);
    return res.status(201).json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/reorder", async (req, res) => {
  const parsed = z.object({ ids: z.array(uuidSchema).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.homeModule.update({
        where: { id },
        data: { sortOrder: (index + 1) * 10 },
      }),
    ),
  );

  return res.json({ data: { updated: parsed.data.ids.length } });
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateModuleSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.homeModule.update({
      where: { id: id.data },
      data: moduleData(parsed.data) as Prisma.HomeModuleUncheckedUpdateInput,
    });
    await replaceModuleItems(data.id, parsed.data.videoIds);
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
    await prisma.homeModule.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
