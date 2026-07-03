import { PrismaClient, HomeModuleQueryType, HomeModuleType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existingModules = await prisma.homeModule.count();
  if (existingModules > 0) {
    console.log(`Home modules già presenti: ${existingModules}. Seed saltato.`);
    return;
  }

  const firstLiveStream = await prisma.liveStream.findFirst({
    where: { status: "LIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  await prisma.homeModule.createMany({
    data: [
      {
        title: "In evidenza",
        subtitle: "Una selezione aggiornata dei contenuti più recenti",
        type: HomeModuleType.CAROUSEL_SLIDER,
        queryType: HomeModuleQueryType.LATEST,
        sortOrder: 10,
        enabled: true,
        limit: 12,
      },
      {
        title: "Live TV",
        subtitle: "Dirette e palinsesto aggiornato",
        type: HomeModuleType.LIVE_EPG,
        queryType: HomeModuleQueryType.LIVE,
        sortOrder: 20,
        enabled: true,
        limit: 12,
        liveStreamId: firstLiveStream?.id ?? null,
      },
      {
        title: "Locandine",
        subtitle: "Programmi e contenuti da scoprire",
        type: HomeModuleType.POSTER_RAIL,
        queryType: HomeModuleQueryType.LATEST,
        sortOrder: 30,
        enabled: true,
        limit: 18,
      },
    ],
  });

  console.log("Creati i moduli home iniziali.");
}

main()
  .catch((error) => {
    console.error("Seed moduli home fallito", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
