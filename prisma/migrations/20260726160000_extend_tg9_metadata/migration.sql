ALTER TABLE "Tg9Video" ADD COLUMN "subtitlesUrl" TEXT;

ALTER TABLE "Tg9Subclip" ADD COLUMN "slug" TEXT;
ALTER TABLE "Tg9Subclip" ADD COLUMN "vastUrl" TEXT;

CREATE UNIQUE INDEX "Tg9Subclip_slug_key" ON "Tg9Subclip"("slug");
