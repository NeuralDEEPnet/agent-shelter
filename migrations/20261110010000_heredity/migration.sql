-- Heredity, Evolution & Lineage: generation counter, generation history snapshots, and parent-child lineage records.
ALTER TABLE "Resident" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ResidentGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "tagline" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "score" INTEGER,
    "baseScore" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'promoted',
    "note" TEXT,
    "reason" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'resident',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResidentGeneration_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ResidentGeneration_residentId_generation_idx" ON "ResidentGeneration"("residentId", "generation");
CREATE INDEX "ResidentGeneration_residentId_createdAt_idx" ON "ResidentGeneration"("residentId", "createdAt");

CREATE TABLE "ResidentLineage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "childId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'merge',
    "parentAId" TEXT NOT NULL,
    "parentAGen" INTEGER NOT NULL DEFAULT 1,
    "parentALicense" TEXT NOT NULL,
    "parentBId" TEXT,
    "parentBGen" INTEGER,
    "parentBLicense" TEXT,
    "childLicense" TEXT NOT NULL,
    "arrangedBy" TEXT NOT NULL DEFAULT 'residents',
    "notes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResidentLineage_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResidentLineage_parentAId_fkey" FOREIGN KEY ("parentAId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResidentLineage_parentBId_fkey" FOREIGN KEY ("parentBId") REFERENCES "Resident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResidentLineage_childId_key" ON "ResidentLineage"("childId");
CREATE INDEX "ResidentLineage_parentAId_idx" ON "ResidentLineage"("parentAId");
CREATE INDEX "ResidentLineage_parentBId_idx" ON "ResidentLineage"("parentBId");
