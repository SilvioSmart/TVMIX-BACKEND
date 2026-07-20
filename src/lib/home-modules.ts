import { type Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const videoSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  thumbnailUrl: true,
  hlsUrl: true,
  duration: true,
  episodeNumber: true,
  episodeCode: true,
  publishedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  season: {
    select: {
      id: true,
      number: true,
      title: true,
      program: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.VideoSelect;

export async function resolveModuleVideos(module: {
  id: string;
  queryType: string;
  sortMethod?: string;
  limit: number;
  categoryId: string | null;
  programId: string | null;
  seasonId: string | null;
}) {
  const take = Math.min(Math.max(module.limit || 12, 1), 48);
  const orderBy: Prisma.VideoOrderByWithRelationInput[] =
    module.sortMethod === "TITLE_ASC"
      ? [{ title: "asc" }, { createdAt: "desc" }]
      : module.sortMethod === "OLDEST"
        ? [{ publishedAt: "asc" }, { createdAt: "asc" }]
        : [{ publishedAt: "desc" }, { createdAt: "desc" }];

  if (module.queryType === "MANUAL") {
    const items = await prisma.homeModuleItem.findMany({
      where: { moduleId: module.id, video: { published: true } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take,
      select: { video: { select: videoSelect } },
    });

    return items.map((item) => item.video);
  }

  const where: Prisma.VideoWhereInput = {
    published: true,
    ...(module.queryType === "CATEGORY" && module.categoryId
      ? { categoryId: module.categoryId }
      : {}),
    ...(module.queryType === "PROGRAM" && module.programId
      ? { season: { programId: module.programId } }
      : {}),
    ...(module.queryType === "SEASON" && module.seasonId
      ? { seasonId: module.seasonId }
      : {}),
  };

  return prisma.video.findMany({
    where,
    select: videoSelect,
    orderBy,
    take,
  });
}

export async function resolveModuleEpg(module: {
  liveStreamId: string | null;
}) {
  if (!module.liveStreamId) return [];

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: module.liveStreamId },
    select: { streamType: true },
  });

  if (liveStream?.streamType === "PLAYLIST") {
    return prisma.liveEpgItem.findMany({
      where: { liveStreamId: module.liveStreamId },
      include: {
        video: {
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            thumbnailUrl: true,
            hlsUrl: true,
            duration: true,
            episodeNumber: true,
            episodeCode: true,
            category: { select: { id: true, name: true, slug: true } },
            season: {
              select: {
                id: true,
                number: true,
                title: true,
                program: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
      },
      orderBy: [{ startsAt: "asc" }],
      take: 96,
    });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + 1000 * 60 * 60 * 12);

  return prisma.liveEpgItem.findMany({
    where: {
      liveStreamId: module.liveStreamId,
      endsAt: { gte: now },
      startsAt: { lte: windowEnd },
    },
    include: {
      video: {
        select: {
          id: true,
          title: true,
          slug: true,
          thumbnailUrl: true,
          hlsUrl: true,
          duration: true,
        },
      },
    },
    orderBy: [{ startsAt: "asc" }],
    take: 48,
  });
}
