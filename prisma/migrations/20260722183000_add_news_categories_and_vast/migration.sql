CREATE TABLE "NewsCategory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsCategory_slug_key" ON "NewsCategory"("slug");
CREATE INDEX "NewsCategory_enabled_sortOrder_idx" ON "NewsCategory"("enabled", "sortOrder");
CREATE INDEX "NewsCategory_name_idx" ON "NewsCategory"("name");

ALTER TABLE "NoticeArticle" ADD COLUMN "categoryId" UUID;
ALTER TABLE "NoticeArticle" ADD COLUMN "vastUrl" TEXT;

INSERT INTO "NewsCategory" ("name", "slug", "sortOrder", "createdAt", "updatedAt")
SELECT
  category,
  lower(regexp_replace(regexp_replace(trim(category), '[^[:alnum:]]+', '-', 'g'), '(^-+|-+$)', '', 'g')) || '-' || row_number() over (order by category),
  row_number() over (order by category) - 1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT category
  FROM "NoticeArticle"
  WHERE category IS NOT NULL AND trim(category) <> ''
) distinct_categories;

UPDATE "NoticeArticle" notice
SET "categoryId" = category."id"
FROM "NewsCategory" category
WHERE notice.category = category.name;

CREATE INDEX "NoticeArticle_categoryId_idx" ON "NoticeArticle"("categoryId");

ALTER TABLE "NoticeArticle"
ADD CONSTRAINT "NoticeArticle_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "NewsCategory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
