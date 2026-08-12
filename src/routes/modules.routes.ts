import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { resolveModuleEpg, resolveModuleVideos } from "../lib/home-modules.js";

const router = Router();

router.get("/", async (_req, res) => {
  const modules = await prisma.homeModule.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      subtitle: true,
      type: true,
      queryType: true,
      sortMethod: true,
      sortOrder: true,
      limit: true,
      categoryId: true,
      programId: true,
      seasonId: true,
      liveStreamId: true,
      liveStream: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          streamType: true,
          hlsUrl: true,
          posterUrl: true,
          vastUrl: true,
          status: true,
        },
      },
    },
  });

  const liveStreams = await prisma.liveStream.findMany({
    where: { streamType: "LIVE_STREAMING" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      streamType: true,
      hlsUrl: true,
      posterUrl: true,
      vastUrl: true,
      status: true,
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
    take: 4,
  });

  const data = await Promise.all(
    modules.map(async (module) => {
      const moduleLiveStreams =
        module.type === "LIVE_EPG" && module.liveStream?.streamType !== "PLAYLIST"
          ? liveStreams
          : [];

      return {
        ...module,
        liveStreams: moduleLiveStreams,
        items: module.type === "LIVE_EPG" ? [] : await resolveModuleVideos(module),
        epg: module.type === "LIVE_EPG" ? await resolveModuleEpg(module) : [],
      };
    }),
  );

  return res.json({ data });
});

export default router;
