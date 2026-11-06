-- Residents created by the operator are labelled honestly as staff / demo residents.
ALTER TABLE "Resident" ADD COLUMN "inHouse" BOOLEAN NOT NULL DEFAULT false;
-- Backfill: the five launch residents were authored by the operator ("Neural Deep …").
UPDATE "Resident" SET "inHouse" = true WHERE "creatorName" LIKE 'Neural Deep%' OR "name" LIKE '%Neural Deep%';
