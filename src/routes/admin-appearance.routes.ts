import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError, sendValidationError } from "../lib/api-validation.js";

const router = Router();

const menuItemKeySchema = z.enum(["logo-name", "menu", "carousel", "modules", "footer"]);
const brandId = "default";

const brandSettingsSchema = z
  .object({
    platformName: z.string().trim().min(2).max(80).optional(),
    logoUrl: z.string().trim().url().nullable().optional(),
    logoObjectKey: z.string().trim().min(1).max(512).nullable().optional(),
    faviconUrl: z.string().trim().url().nullable().optional(),
    faviconObjectKey: z.string().trim().min(1).max(512).nullable().optional(),
    accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colore non valido: usa formato #RRGGBB").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Specificare almeno un campo da aggiornare",
  });

const updateMenuItemSchema = z
  .object({
    label: z.string().trim().min(2).max(40).optional(),
    description: z.string().trim().max(240).nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Specificare almeno un campo da aggiornare",
  });

router.get("/menu", async (_req, res) => {
  const data = await prisma.appearanceMenuItem.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  return res.json({ data });
});

router.get("/menu/all", async (_req, res) => {
  const data = await prisma.appearanceMenuItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  return res.json({ data });
});

router.get("/brand", async (_req, res) => {
  const data = await prisma.appearanceBrandSettings.upsert({
    where: { id: brandId },
    create: { id: brandId },
    update: {},
  });

  return res.json({ data });
});

router.patch("/brand", async (req, res) => {
  const parsed = brandSettingsSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.appearanceBrandSettings.upsert({
      where: { id: brandId },
      create: {
        id: brandId,
        ...parsed.data,
      },
      update: parsed.data,
    });

    return res.json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

router.patch("/menu/:key", async (req, res) => {
  const key = menuItemKeySchema.safeParse(req.params.key);
  const parsed = updateMenuItemSchema.safeParse(req.body);

  if (!key.success) return sendValidationError(res, key.error, "Voce menu non valida");
  if (!parsed.success) return sendValidationError(res, parsed.error);

  try {
    const data = await prisma.appearanceMenuItem.update({
      where: { key: key.data },
      data: parsed.data,
    });

    return res.json({ data });
  } catch (error) {
    if (handlePrismaError(res, error)) return;
    throw error;
  }
});

export default router;
