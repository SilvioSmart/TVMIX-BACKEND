import crypto from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

type RawBodyRequest = Request & { rawBody?: Buffer };

const readyWebhookSchema = z.object({
  event: z.literal("video.ready"),
  videoId: z.string().uuid(),
  status: z.literal("ready"),
  masterUrl: z.string().url(),
  durationSeconds: z.number().finite().nonnegative().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  slug: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2000).optional(),
  thumbnailUrl: z.string().url().optional(),
  categorySlug: z.string().trim().min(1).max(80).optional(),
  categoryName: z.string().trim().min(1).max(120).optional(),
  completedAt: z.string().datetime().optional(),
  source: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    hasAudio: z.boolean().optional(),
  }).optional(),
  renditions: z.array(z.object({
    name: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  })).optional(),
});

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function verifySignature(req: RawBodyRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  const rawBody = req.rawBody;
  const received = req.header("x-tvmix-signature") ?? "";
  if (!rawBody || !received) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

router.post("/webhooks/video-ready", async (req: RawBodyRequest, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: "Firma webhook non valida" });
  const parsed = readyWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Payload webhook non valido", details: parsed.error.flatten().fieldErrors });
  }
  const payload = parsed.data;
  const fallbackTitle = `Video ${payload.videoId.slice(0, 8)}`;
  const title = payload.title ?? fallbackTitle;
  const baseSlug = slugify(payload.slug ?? title) || payload.videoId;
  const categorySlug = slugify(payload.categorySlug ?? "on-demand");
  const categoryName = payload.categoryName ?? "On demand";
  const duration = payload.durationSeconds ? Math.round(payload.durationSeconds) : undefined;
  const bestRendition = payload.renditions?.[0]?.name;
  const sourceQuality =
    payload.source?.height ? `${payload.source.height}p` : bestRendition;
  const convertedObjectKey = (() => {
    try {
      const url = new URL(payload.masterUrl);
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  })();
  const category = await prisma.category.upsert({
    where: { slug: categorySlug },
    create: { name: categoryName, slug: categorySlug, description: "Contenuti video pubblicati da TVMIX-WORKER" },
    update: {},
  });
  const existing = await prisma.video.findUnique({ where: { id: payload.videoId }, select: { id: true, publishedAt: true } });
  const video = existing
    ? await prisma.video.update({
        where: { id: payload.videoId },
        data: {
          hlsUrl: payload.masterUrl,
          ...(duration !== undefined ? { duration } : {}),
          mediaFormat: "HLS",
          videoQuality: sourceQuality,
          audioTracks: payload.source?.hasAudio ? [{ codec: "aac", channels: 2 }] : [],
          convertedObjectKey,
          ...(payload.thumbnailUrl ? { thumbnailUrl: payload.thumbnailUrl } : {}),
          ...(payload.description ? { description: payload.description } : {}),
          processingStatus: "READY",
          processingError: null,
          published: true,
          publishedAt: existing.publishedAt ?? new Date(),
        },
        select: { id: true, slug: true, hlsUrl: true, processingStatus: true, published: true },
      })
    : await prisma.video.create({
        data: {
          id: payload.videoId,
          title,
          slug: `${baseSlug}-${payload.videoId.slice(0, 8)}`,
          description: payload.description,
          thumbnailUrl: payload.thumbnailUrl,
          hlsUrl: payload.masterUrl,
          ...(duration !== undefined ? { duration } : {}),
          mediaFormat: "HLS",
          videoQuality: sourceQuality,
          audioTracks: payload.source?.hasAudio ? [{ codec: "aac", channels: 2 }] : [],
          convertedObjectKey,
          processingStatus: "READY",
          processingError: null,
          published: true,
          publishedAt: new Date(),
          categoryId: category.id,
        },
        select: { id: true, slug: true, hlsUrl: true, processingStatus: true, published: true },
      });
  return res.json({ ok: true, data: video });
});

export default router;
