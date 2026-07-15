CREATE TYPE "MediaUploadStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABORTED', 'FAILED');

CREATE TABLE "MediaUploadSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "logicalUploadId" UUID NOT NULL,
  "multipartUploadId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "partSize" INTEGER NOT NULL,
  "totalParts" INTEGER NOT NULL,
  "uploadedParts" JSONB NOT NULL DEFAULT '[]',
  "status" "MediaUploadStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "error" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "abortedAt" TIMESTAMP(3),
  CONSTRAINT "MediaUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaUploadSession_logicalUploadId_key" ON "MediaUploadSession"("logicalUploadId");
CREATE INDEX "MediaUploadSession_status_updatedAt_idx" ON "MediaUploadSession"("status", "updatedAt");
CREATE INDEX "MediaUploadSession_objectKey_idx" ON "MediaUploadSession"("objectKey");
