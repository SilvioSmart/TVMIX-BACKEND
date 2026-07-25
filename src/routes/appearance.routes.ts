import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();
const brandId = "default";

router.get("/brand", async (_req, res) => {
  const data = await prisma.appearanceBrandSettings.upsert({
    where: { id: brandId },
    create: { id: brandId },
    update: {},
  });

  return res.json({ data });
});

export default router;
