-- Bounty hardening after review:
--   * an external feed id is unique PER POSTER (scope|externalId), so an anonymous caller cannot squat
--     another feed's ids and swallow its proposals as "duplicates";
--   * the owner can withhold a delivery's text on every surface (board, API, MCP, page), like a hidden
--     Commons post — never deleted.
DROP INDEX "Bounty_externalId_key";
ALTER TABLE "Bounty" ADD COLUMN "externalKey" TEXT;
CREATE UNIQUE INDEX "Bounty_externalKey_key" ON "Bounty"("externalKey");
ALTER TABLE "BountyAttempt" ADD COLUMN "hiddenAt" DATETIME;
ALTER TABLE "BountyAttempt" ADD COLUMN "hiddenNote" TEXT;
