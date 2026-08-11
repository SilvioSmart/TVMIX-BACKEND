CREATE TABLE "Tg9Subclip" (
  "id" UUID NOT NULL,
  "tg9VideoId" UUID NOT NULL,
  "title" TEXT,
  "startTime" INTEGER NOT NULL,
  "endTime" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tg9Subclip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Tg9Subclip_tg9VideoId_sortOrder_idx" ON "Tg9Subclip"("tg9VideoId", "sortOrder");
CREATE INDEX "Tg9Subclip_tg9VideoId_startTime_idx" ON "Tg9Subclip"("tg9VideoId", "startTime");

ALTER TABLE "Tg9Subclip"
  ADD CONSTRAINT "Tg9Subclip_tg9VideoId_fkey"
  FOREIGN KEY ("tg9VideoId") REFERENCES "Tg9Video"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
