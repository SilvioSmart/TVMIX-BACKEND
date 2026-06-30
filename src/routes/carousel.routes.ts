import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  const now = new Date();

  const data = await prisma.homepageCarouselSlide.findMany({
    where: {
      published: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    select: {
      id: true,
      eyebrow: true,
      title: true,
      subtitle: true,
      description: true,
      imageUrl: true,
      ctaLabel: true,
      ctaUrl: true,
      sortOrder: true,
      video: {
        select: {
          id: true,
          title: true,
          slug: true,
          thumbnailUrl: true,
          hlsUrl: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });

  return res.json({ data });
});

export default router;
