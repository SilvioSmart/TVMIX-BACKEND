CREATE TYPE "UserPermission" AS ENUM (
  'CONTENT_VIEW',
  'CONTENT_MANAGE',
  'CATALOG_MANAGE',
  'LIVE_MANAGE',
  'APPEARANCE_MANAGE',
  'USERS_MANAGE',
  'SETTINGS_MANAGE',
  'HLS_MANAGE',
  'VAST_MANAGE'
);

ALTER TABLE "User"
  ADD COLUMN "permissions" "UserPermission"[] NOT NULL DEFAULT ARRAY[]::"UserPermission"[],
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationHash" TEXT,
  ADD COLUMN "emailVerificationExpires" TIMESTAMP(3),
  ADD COLUMN "passwordResetHash" TEXT,
  ADD COLUMN "passwordResetExpires" TIMESTAMP(3);

UPDATE "User"
SET "permissions" = ARRAY[
  'CONTENT_VIEW',
  'CONTENT_MANAGE',
  'CATALOG_MANAGE',
  'LIVE_MANAGE',
  'APPEARANCE_MANAGE',
  'USERS_MANAGE',
  'SETTINGS_MANAGE',
  'HLS_MANAGE',
  'VAST_MANAGE'
]::"UserPermission"[],
"emailVerifiedAt" = COALESCE("emailVerifiedAt", NOW())
WHERE "role" = 'ADMIN';

UPDATE "User"
SET "permissions" = ARRAY[
  'CONTENT_VIEW',
  'CONTENT_MANAGE',
  'CATALOG_MANAGE',
  'LIVE_MANAGE',
  'APPEARANCE_MANAGE',
  'HLS_MANAGE',
  'VAST_MANAGE'
]::"UserPermission"[],
"emailVerifiedAt" = COALESCE("emailVerifiedAt", NOW())
WHERE "role" = 'EDITOR';

UPDATE "User"
SET "permissions" = ARRAY['CONTENT_VIEW']::"UserPermission"[]
WHERE "role" = 'USER';

CREATE INDEX "User_emailVerificationHash_idx" ON "User"("emailVerificationHash");
CREATE INDEX "User_passwordResetHash_idx" ON "User"("passwordResetHash");
