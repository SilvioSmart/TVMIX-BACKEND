import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getTranscodeQueue } from "../lib/transcodeQueue.js";

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

const transcodeRequestSchema = z.object({
  sourcePath: z.string().trim().min(1),
  title: z.string().trim().min(1).max(180).optional(),
  slug: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2000).optional(),
  thumbnailUrl: z.string().url().optional(),
  categorySlug: z.string().trim().min(1).max(80).optional(),
  categoryName: z.string().trim().min(1).max(120).optional(),
});

router.post("/:id/transcode", async (req, res) => {
  const secret = process.env.INTERNAL_API_SECRET;
  const authorization = req.header("authorization") ?? "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Non autorizzato" });
  }

  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "ID video non valido" });
  }

  const parsed = transcodeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Richiesta transcodifica non valida",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const queue = getTranscodeQueue();
  const job = await queue.add(
    "transcode-hls",
    { videoId: id.data, ...parsed.data },
    {
      jobId: `video-${id.data}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600, count: 5000 },
    },
  );

  return res.status(202).json({
    ok: true,
    data: {
      jobId: job.id,
      videoId: id.data,
      queue: process.env.QUEUE_NAME ?? "tvmix-video-transcoding",
    },
  });
});

export default router;
