CREATE TYPE "HomeModuleSortMethod" AS ENUM ('RECENT', 'OLDEST', 'TITLE_ASC');

ALTER TABLE "HomeModule"
ADD COLUMN "sortMethod" "HomeModuleSortMethod" NOT NULL DEFAULT 'RECENT';
