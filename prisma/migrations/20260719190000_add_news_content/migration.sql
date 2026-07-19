CREATE TABLE "NoticeArticle" (
  "id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "excerpt" TEXT,
  "body" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "imageObjectKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NoticeArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoticeArticle_slug_key" ON "NoticeArticle"("slug");
CREATE INDEX "NoticeArticle_published_publishedAt_idx" ON "NoticeArticle"("published", "publishedAt");
CREATE INDEX "NoticeArticle_sortOrder_createdAt_idx" ON "NoticeArticle"("sortOrder", "createdAt");
CREATE INDEX "NoticeArticle_category_idx" ON "NoticeArticle"("category");

CREATE TABLE "Tg9Video" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "videoUrl" TEXT NOT NULL,
  "videoObjectKey" TEXT,
  "posterUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tg9Video_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tg9Video_slug_key" ON "Tg9Video"("slug");
CREATE INDEX "Tg9Video_published_sortOrder_idx" ON "Tg9Video"("published", "sortOrder");
CREATE INDEX "Tg9Video_publishedAt_idx" ON "Tg9Video"("publishedAt");
