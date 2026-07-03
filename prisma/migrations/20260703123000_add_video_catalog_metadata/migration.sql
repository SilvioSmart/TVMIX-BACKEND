ALTER TABLE "Video"
ADD COLUMN "mediaFormat" TEXT,
ADD COLUMN "videoQuality" TEXT,
ADD COLUMN "audioTracks" JSONB,
ADD COLUMN "convertedObjectKey" TEXT,
ADD COLUMN "episodeNumber" INTEGER,
ADD COLUMN "episodeCode" VARCHAR(6);

CREATE UNIQUE INDEX "Video_episodeCode_key" ON "Video"("episodeCode");
CREATE INDEX "Video_episodeCode_idx" ON "Video"("episodeCode");
