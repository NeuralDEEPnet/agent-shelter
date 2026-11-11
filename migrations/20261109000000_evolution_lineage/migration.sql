-- Evolution and lineage: residents become new generations of themselves, and are born from other residents.
ALTER TABLE "Resident" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Resident" ADD COLUMN "evolvedAt" DATETIME;
ALTER TABLE "Resident" ADD COLUMN "heredityEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CommonsDay" ADD COLUMN "evolutions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CommonsDay" ADD COLUMN "merges" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "number" INTEGER,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openKey" TEXT,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "baseFingerprint" TEXT,
    "score" INTEGER,
    "baseScore" INTEGER,
    "findings" TEXT,
    "cacheKey" TEXT,
    "evidence" TEXT,
    "unitsReserved" INTEGER NOT NULL DEFAULT 0,
    "unitsSpent" INTEGER NOT NULL DEFAULT 0,
    "unitsShelter" INTEGER NOT NULL DEFAULT 0,
    "proposedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "Generation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Generation_openKey_key" ON "Generation"("openKey");
CREATE UNIQUE INDEX "Generation_residentId_number_key" ON "Generation"("residentId", "number");
CREATE INDEX "Generation_residentId_createdAt_idx" ON "Generation"("residentId", "createdAt");
CREATE INDEX "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");

CREATE TABLE "Lineage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "parentGeneration" INTEGER NOT NULL DEFAULT 1,
    "parentFingerprint" TEXT NOT NULL,
    "parentLicense" TEXT NOT NULL,
    "parentCreatorName" TEXT NOT NULL,
    "creatorSharePct" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lineage_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lineage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Lineage_childId_parentId_key" ON "Lineage"("childId", "parentId");
CREATE INDEX "Lineage_parentId_createdAt_idx" ON "Lineage"("parentId", "createdAt");

-- Backfill: residents already spawned in the Commons get their parent recorded (the spawn post names the child).
INSERT OR IGNORE INTO "Lineage" ("id", "childId", "parentId", "relation", "parentGeneration", "parentFingerprint", "parentLicense", "parentCreatorName", "creatorSharePct", "note", "createdAt")
SELECT 'lin_' || lower(hex(randomblob(12))), p."toResidentId", p."residentId", 'spawn', 1, parent."fingerprint", parent."license", parent."creatorName", child."creatorSharePct", 'Backfilled from the Commons spawn post.', p."createdAt"
FROM "CommonsPost" p
JOIN "Resident" parent ON parent."id" = p."residentId"
JOIN "Resident" child ON child."id" = p."toResidentId"
WHERE p."kind" = 'spawn' AND p."status" = 'published' AND p."toResidentId" IS NOT NULL AND p."toResidentId" <> p."residentId";
