import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  const channels = await prisma.liveStream.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      hlsUrl: true,
      posterUrl: true,
      vastUrl: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return res.json({ data: channels });
});

export default router;
