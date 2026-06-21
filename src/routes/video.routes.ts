import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().min(1).optional(),
});

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Parametri di paginazione non validi",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { page, limit, category } = parsed.data;
  const where = {
    published: true,
    ...(category ? { category: { slug: category } } : {}),
  };

  const [videos, total] = await prisma.$transaction([
    prisma.video.findMany({
      where,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        thumbnailUrl: true,
        hlsUrl: true,
        duration: true,
        publishedAt: true,
        category: {
          select: { id: true, name: true, slug: true },
        },
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.video.count({ where }),
  ]);

  return res.json({
    data: videos,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

router.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);

  if (!id.success) {
    return res.status(400).json({ error: "ID video non valido" });
  }

  const video = await prisma.video.findFirst({
    where: { id: id.data, published: true },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      thumbnailUrl: true,
      hlsUrl: true,
      duration: true,
      publishedAt: true,
      category: {
        select: { id: true, name: true, slug: true, description: true },
      },
    },
  });

  if (!video) {
    return res.status(404).json({ error: "Video non trovato" });
  }

  return res.json({ data: video });
});

export default router;
