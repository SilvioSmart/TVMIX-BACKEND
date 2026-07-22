import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/notice", async (_req, res) => {
  const data = await prisma.noticeArticle.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return res.json({ data });
});

router.get("/notice/:slug", async (req, res) => {
  const data = await prisma.noticeArticle.findFirst({
    where: {
      slug: req.params.slug,
      published: true,
    },
  });
  if (!data) return res.status(404).json({ error: "Notizia non trovata" });
  return res.json({ data });
});

router.get("/tg9", async (_req, res) => {
  const data = await prisma.tg9Video.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return res.json({ data });
});

export default router;
