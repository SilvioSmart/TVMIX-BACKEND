import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

const pageSlugSchema = z.enum([
  "chi-siamo",
  "contatti",
  "assistenza",
  "lavora-con-noi",
  "privacy-policy",
  "cookie",
]);

router.get("/", async (_req, res) => {
  const data = await prisma.staticPageContent.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return res.json({ data });
});

router.get("/:slug", async (req, res) => {
  const parsed = pageSlugSchema.safeParse(req.params.slug);
  if (!parsed.success) return res.status(404).json({ error: "Pagina non trovata" });

  const data = await prisma.staticPageContent.findFirst({
    where: { slug: parsed.data, published: true },
  });

  if (!data) return res.status(404).json({ error: "Pagina non trovata" });
  return res.json({ data });
});

export default router;
