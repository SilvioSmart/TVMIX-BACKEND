CREATE TABLE "HomepageCarouselSlide" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eyebrow" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "videoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageCarouselSlide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomepageCarouselSlide_published_sortOrder_idx" ON "HomepageCarouselSlide"("published", "sortOrder");
CREATE INDEX "HomepageCarouselSlide_videoId_idx" ON "HomepageCarouselSlide"("videoId");

ALTER TABLE "HomepageCarouselSlide"
ADD CONSTRAINT "HomepageCarouselSlide_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "HomepageCarouselSlide"
  ("eyebrow", "title", "subtitle", "description", "imageUrl", "ctaLabel", "ctaUrl", "sortOrder", "published", "updatedAt")
VALUES
  (
    'TVMIX ORIGINAL',
    'SENZA FILTRI',
    'Storie vere, domande dirette.',
    'Un confronto senza scorciatoie con i protagonisti del nostro tempo. Nuove puntate ogni domenica.',
    '/images/senza-filtri-hero.png',
    'Guarda ora',
    '#programmi',
    10,
    true,
    CURRENT_TIMESTAMP
  );
