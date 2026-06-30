CREATE TYPE "VideoProcessingStatus" AS ENUM (
  'PENDING',
  'UPLOADING',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED'
);

ALTER TABLE "Video"
ALTER COLUMN "hlsUrl" DROP NOT NULL,
ADD COLUMN "sourceObjectKey" TEXT,
ADD COLUMN "originalFileName" TEXT,
ADD COLUMN "processingStatus" "VideoProcessingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "processingError" TEXT;
