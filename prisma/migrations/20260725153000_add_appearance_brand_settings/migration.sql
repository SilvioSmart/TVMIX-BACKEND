CREATE TABLE IF NOT EXISTS "AppearanceBrandSettings" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "platformName" TEXT NOT NULL DEFAULT 'TVMIX',
  "logoUrl" TEXT,
  "logoObjectKey" TEXT,
  "faviconUrl" TEXT,
  "faviconObjectKey" TEXT,
  "accentColor" VARCHAR(16) NOT NULL DEFAULT '#16b9f4',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppearanceBrandSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppearanceBrandSettings" ("id", "platformName", "accentColor", "updatedAt")
VALUES ('default', 'TVMIX', '#16b9f4', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
