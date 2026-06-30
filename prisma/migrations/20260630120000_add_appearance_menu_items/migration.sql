CREATE TABLE "AppearanceMenuItem" (
    "key" VARCHAR(32) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppearanceMenuItem_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AppearanceMenuItem_enabled_sortOrder_idx" ON "AppearanceMenuItem"("enabled", "sortOrder");

INSERT INTO "AppearanceMenuItem" ("key", "label", "description", "sortOrder", "enabled", "updatedAt")
VALUES
  ('logo-name', 'LOGO/NAME', 'Identità visiva, logo e nome piattaforma', 10, true, CURRENT_TIMESTAMP),
  ('menu', 'MENU''', 'Navigazione e voci menu del frontend', 20, true, CURRENT_TIMESTAMP),
  ('carousel', 'CAROUSELL', 'Carousel, hero e contenuti in evidenza', 30, true, CURRENT_TIMESTAMP),
  ('modules', 'MODULI', 'Blocchi homepage e sezioni editoriali', 40, true, CURRENT_TIMESTAMP),
  ('footer', 'FOOTER', 'Footer, link legali e contatti', 50, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sortOrder" = EXCLUDED."sortOrder",
  "enabled" = EXCLUDED."enabled",
  "updatedAt" = CURRENT_TIMESTAMP;
