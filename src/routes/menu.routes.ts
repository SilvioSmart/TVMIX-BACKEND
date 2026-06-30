import { MenuItemPlacement } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

const placementSchema = z.nativeEnum(MenuItemPlacement);

router.get("/", async (req, res) => {
  const parsed = z
    .object({
      placement: placementSchema.optional(),
    })
    .safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Filtri menu non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const placement = parsed.data.placement;
  const data = await prisma.frontendMenuItem.findMany({
    where: {
      enabled: true,
      ...(placement ? { placements: { has: placement } } : {}),
    },
    select: {
      id: true,
      label: true,
      url: true,
      placement: true,
      placements: true,
      sortOrder: true,
      external: true,
      parentId: true,
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  return res.json({ data });
});

export default router;
