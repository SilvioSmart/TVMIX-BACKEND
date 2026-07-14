ALTER TABLE "LiveEpgItem"
ADD COLUMN "videoId" UUID;

CREATE INDEX "LiveEpgItem_videoId_idx" ON "LiveEpgItem"("videoId");

ALTER TABLE "LiveEpgItem"
ADD CONSTRAINT "LiveEpgItem_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
