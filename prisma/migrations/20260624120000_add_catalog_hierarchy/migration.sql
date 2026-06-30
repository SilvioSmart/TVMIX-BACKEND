CREATE TABLE "Program" (
    "id" VARCHAR(5) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Season" (
    "id" VARCHAR(6) NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "programId" VARCHAR(5) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Video" ADD COLUMN "seasonId" VARCHAR(6);

CREATE UNIQUE INDEX "Program_slug_key" ON "Program"("slug");
CREATE INDEX "Program_categoryId_name_idx" ON "Program"("categoryId", "name");
CREATE UNIQUE INDEX "Season_programId_number_key" ON "Season"("programId", "number");
CREATE INDEX "Season_programId_number_idx" ON "Season"("programId", "number");
CREATE INDEX "Video_seasonId_idx" ON "Video"("seasonId");

ALTER TABLE "Program"
ADD CONSTRAINT "Program_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Season"
ADD CONSTRAINT "Season_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Video"
ADD CONSTRAINT "Video_seasonId_fkey"
FOREIGN KEY ("seasonId") REFERENCES "Season"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
