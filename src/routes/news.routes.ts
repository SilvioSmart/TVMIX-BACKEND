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

router.get("/tg9", async (_req, res) => {
  const data = await prisma.tg9Video.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return res.json({ data });
});

export default router;
