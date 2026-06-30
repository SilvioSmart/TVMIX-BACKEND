ALTER TABLE "FrontendMenuItem"
ADD COLUMN "placements" "MenuItemPlacement"[] NOT NULL DEFAULT ARRAY['HEADER']::"MenuItemPlacement"[];

UPDATE "FrontendMenuItem"
SET "placements" = ARRAY["placement"]::"MenuItemPlacement"[]
WHERE cardinality("placements") = 1 AND "placements"[1] = 'HEADER';
