CREATE TYPE "MenuItemPlacement" AS ENUM ('HEADER', 'FOOTER', 'MOBILE');

CREATE TABLE "FrontendMenuItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "placement" "MenuItemPlacement" NOT NULL DEFAULT 'HEADER',
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontendMenuItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrontendMenuItem_placement_enabled_sortOrder_idx" ON "FrontendMenuItem"("placement", "enabled", "sortOrder");
CREATE INDEX "FrontendMenuItem_parentId_idx" ON "FrontendMenuItem"("parentId");

ALTER TABLE "FrontendMenuItem"
ADD CONSTRAINT "FrontendMenuItem_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "FrontendMenuItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FrontendMenuItem" ("label", "url", "placement", "sortOrder", "enabled", "external", "updatedAt")
VALUES
  ('Live', '#live', 'HEADER', 10, true, false, CURRENT_TIMESTAMP),
  ('Programmi', '#programmi', 'HEADER', 20, true, false, CURRENT_TIMESTAMP),
  ('Categorie', '#categorie', 'HEADER', 30, true, false, CURRENT_TIMESTAMP),
  ('Privacy', '/privacy', 'FOOTER', 10, true, false, CURRENT_TIMESTAMP),
  ('Termini', '/termini', 'FOOTER', 20, true, false, CURRENT_TIMESTAMP),
  ('Contatti', '/contatti', 'FOOTER', 30, true, false, CURRENT_TIMESTAMP);
