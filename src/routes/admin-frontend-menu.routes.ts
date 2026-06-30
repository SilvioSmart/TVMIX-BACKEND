import { MenuItemPlacement } from "@prisma/client";
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

const placementSchema = z.nativeEnum(MenuItemPlacement);
const placementsSchema = z.array(placementSchema).min(1).max(3);

const menuItemSchema = z.object({
  label: z.string().trim().min(2).max(60),
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^(\/|#|https?:\/\/)/, "Usare un URL interno, ancora # o URL http/https"),
  placement: placementSchema.default("HEADER"),
  placements: placementsSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  enabled: z.boolean().default(true),
  external: z.boolean().default(false),
  parentId: z.union([uuidSchema, z.literal(""), z.null()]).transform((value) => value || null).optional(),
});

const updateMenuItemSchema = menuItemSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  "Specificare almeno un campo da aggiornare",
);

router.get("/", async (req, res) => {
  const query = paginationSchema
    .extend({
      placement: placementSchema.optional(),
    })
    .safeParse(req.query);

  if (!query.success) return sendValidationError(res, query.error, "Filtri non validi");

  const { page, limit, search, placement } = query.data;
  const where = {
    ...(placement ? { placements: { has: placement } } : {}),
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: "insensitive" as const } },
            { url: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, total] = await prisma.$transaction([
    prisma.frontendMenuItem.findMany({
      where,
      include: {
        parent: { select: { id: true, label: true } },
        _count: { select: { children: true } },
      },
      orderBy: placement
        ? [{ sortOrder: "asc" }, { label: "asc" }]
        : [{ placement: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.frontendMenuItem.count({ where }),
  ]);

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.post("/", async (req, res) => {
  const parsed = menuItemSchema.strict().safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const placements = parsed.data.placements ?? [parsed.data.placement];
    const data = await prisma.frontendMenuItem.create({
      data: {
        ...parsed.data,
        placement: placements[0],
        placements,
      },
    });
    return res.status(201).json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/reorder/:placement", async (req, res) => {
  const placement = placementSchema.safeParse(req.params.placement);
  const parsed = z
    .object({
      ids: z.array(uuidSchema).min(1).max(200),
    })
    .safeParse(req.body);

  if (!placement.success) return sendValidationError(res, placement.error, "Area non valida");
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const updates = parsed.data.ids.map((id, index) =>
    prisma.frontendMenuItem.update({
      where: { id },
      data: { sortOrder: (index + 1) * 10 },
    }),
  );

  try {
    await prisma.$transaction(updates);
    return res.json({ data: { updated: updates.length } });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  const parsed = updateMenuItemSchema.safeParse(req.body);
  if (!id.success) return sendValidationError(res, id.error);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const placements = parsed.data.placements;
    const data = await prisma.frontendMenuItem.update({
      where: { id: id.data },
      data: {
        ...parsed.data,
        ...(placements ? { placement: placements[0], placements } : {}),
      },
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
    await prisma.frontendMenuItem.delete({ where: { id: id.data } });
    return res.status(204).send();
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
