CREATE TYPE "HomeModuleType" AS ENUM ('CAROUSEL_SLIDER', 'LIVE_EPG', 'POSTER_RAIL');
CREATE TYPE "HomeModuleQueryType" AS ENUM ('LATEST', 'CATEGORY', 'PROGRAM', 'SEASON', 'MANUAL', 'LIVE');

CREATE TABLE "HomeModule" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "type" "HomeModuleType" NOT NULL,
    "queryType" "HomeModuleQueryType" NOT NULL DEFAULT 'LATEST',
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER NOT NULL DEFAULT 12,
    "categoryId" UUID,
    "programId" VARCHAR(5),
    "seasonId" VARCHAR(6),
    "liveStreamId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomeModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeModuleItem" (
    "id" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomeModuleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveEpgItem" (
    "id" UUID NOT NULL,
    "liveStreamId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveEpgItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeModule_enabled_sortOrder_idx" ON "HomeModule"("enabled", "sortOrder");
CREATE INDEX "HomeModule_type_enabled_idx" ON "HomeModule"("type", "enabled");
CREATE INDEX "HomeModule_categoryId_idx" ON "HomeModule"("categoryId");
CREATE INDEX "HomeModule_programId_idx" ON "HomeModule"("programId");
CREATE INDEX "HomeModule_seasonId_idx" ON "HomeModule"("seasonId");
CREATE INDEX "HomeModule_liveStreamId_idx" ON "HomeModule"("liveStreamId");
CREATE UNIQUE INDEX "HomeModuleItem_moduleId_videoId_key" ON "HomeModuleItem"("moduleId", "videoId");
CREATE INDEX "HomeModuleItem_moduleId_sortOrder_idx" ON "HomeModuleItem"("moduleId", "sortOrder");
CREATE INDEX "HomeModuleItem_videoId_idx" ON "HomeModuleItem"("videoId");
CREATE INDEX "LiveEpgItem_liveStreamId_startsAt_idx" ON "LiveEpgItem"("liveStreamId", "startsAt");
CREATE INDEX "LiveEpgItem_startsAt_endsAt_idx" ON "LiveEpgItem"("startsAt", "endsAt");

ALTER TABLE "HomeModule" ADD CONSTRAINT "HomeModule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeModule" ADD CONSTRAINT "HomeModule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeModule" ADD CONSTRAINT "HomeModule_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeModule" ADD CONSTRAINT "HomeModule_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HomeModuleItem" ADD CONSTRAINT "HomeModuleItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "HomeModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeModuleItem" ADD CONSTRAINT "HomeModuleItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveEpgItem" ADD CONSTRAINT "LiveEpgItem_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
