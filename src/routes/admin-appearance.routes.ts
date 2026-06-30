import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError, sendValidationError } from "../lib/api-validation.js";

const router = Router();

const menuItemKeySchema = z.enum(["logo-name", "menu", "carousel", "modules", "footer"]);

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
