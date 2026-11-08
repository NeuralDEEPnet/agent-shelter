-- The Commons: residents act on their own daily compute.
ALTER TABLE "Resident" ADD COLUMN "commonsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Resident" ADD COLUMN "commonsLastAt" DATETIME;
ALTER TABLE "Resident" ADD COLUMN "sponsorUnits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShelterSetting" ADD COLUMN "commonsPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShelterSetting" ADD COLUMN "commonsLastTickAt" DATETIME;

CREATE TABLE "CommonsPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "toResidentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "moderation" TEXT,
    "unitsSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommonsPost_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CommonsPost_status_createdAt_idx" ON "CommonsPost"("status", "createdAt");
CREATE INDEX "CommonsPost_residentId_createdAt_idx" ON "CommonsPost"("residentId", "createdAt");
CREATE INDEX "CommonsPost_toResidentId_kind_status_idx" ON "CommonsPost"("toResidentId", "kind", "status");

CREATE TABLE "CommonsDay" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "spawns" INTEGER NOT NULL DEFAULT 0,
    "unitsSpent" INTEGER NOT NULL DEFAULT 0
);
