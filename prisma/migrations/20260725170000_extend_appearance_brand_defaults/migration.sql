UPDATE "AppearanceMenuItem"
SET
  "label" = 'LOGO/NAME/COLOR',
  "description" = 'Identità visiva, logo, nome piattaforma e colore sito',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'logo-name';

ALTER TABLE "AppearanceBrandSettings"
  ADD COLUMN IF NOT EXISTS "defaultThumbnailUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultThumbnailObjectKey" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultSignalUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultSignalObjectKey" TEXT;
