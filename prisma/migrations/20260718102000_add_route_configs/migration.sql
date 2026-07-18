CREATE TABLE "RouteConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "host" TEXT,
  "port" INTEGER,
  "username" TEXT,
  "authMode" TEXT,
  "remotePath" TEXT,
  "importPath" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RouteConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteConfig_name_key" ON "RouteConfig"("name");
CREATE INDEX "RouteConfig_enabled_name_idx" ON "RouteConfig"("enabled", "name");
