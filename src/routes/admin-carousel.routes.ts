import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  handlePrismaError,
  paginationSchema,
  sendValidationError,
  uuidSchema,
} from "../lib/api-validation.js";

const router = Router();

const internalOrExternalUrlSchema = z
  .union([
    z.string().trim().url(),
    z.string().trim().regex(/^(\/|#)/, "Usare URL assoluto, percorso interno o ancora #"),
    z.literal(""),
    z.null(),
  ])
  .transform((value) => (value === "" ? null : value))
  .optional();

const carouselDateSchema = z
  .union([z.literal(""), z.null(), z.coerce.date()])
  .transform((value) => (value === "" ? null : value))
  .optional();

const slideBaseSchema = z.object({
    eyebrow: z.string().trim().max(80).nullable().optional(),
    title: z.string().trim().min(2).max(120),
    subtitle: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    imageUrl: z.union([z.string().trim().url(), z.string().trim().regex(/^\//)]),
    ctaLabel: z.string().trim().max(40).nullable().optional(),
    ctaUrl: internalOrExternalUrlSchema,
    sortOrder: z.coerce.number().int().min(0).max(9999),
    published: z.boolean().default(false),
    startsAt: carouselDateSchema,
    endsAt: carouselDateSchema,
    videoId: z.union([uuidSchema, z.literal(""), z.null()]).transform((value) => value || null).optional(),
  });

const slideSchema = slideBaseSchema
  .refine(
    (value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt,
    "La data fine deve essere successiva alla data inizio",
  );

const updateSlideSchema = slideBaseSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Specificare almeno un campo da aggiornare")
  .refine(
    (value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt,
    "La data fine deve essere successiva alla data inizio",
  );

router.get("/", async (req, res) => {
  const query = paginationSchema
    .extend({
      published: z.coerce.boolean().optional(),
    })
    .safeParse(req.query);

  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, published } = query.data;
  const where = {
    ...(typeof published === "boolean" ? { published } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { subtitle: { contains: search, mode: "insensitive" as const } },
            { eyebrow: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.homepageCarouselSlide.findMany({
      where,
      include: { video: { select: { id: true, title: true, slug: true } } },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.homepageCarouselSlide.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.post("/", async (req, res) => {
  const parsed = slideSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.homepageCarouselSlide.create({ data: parsed.data });
    return res.status(201).json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/reorder", async (req, res) => {
  const parsed = z.object({ ids: z.array(uuidSchema).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    await prisma.$transaction(
      parsed.data.ids.map((id, index) =>
        prisma.homepageCarouselSlide.update({
          where: { id },
          data: { sortOrder: (index + 1) * 10 },
        }),
      ),
    );
    return res.json({ data: { updated: parsed.data.ids.length } });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateSlideSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.homepageCarouselSlide.update({
      where: { id: id.data },
      data: parsed.data,
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
    await prisma.homepageCarouselSlide.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
