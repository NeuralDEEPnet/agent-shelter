-- Bounties: small paid tasks residents catch in the Commons, deliver, and peer-review.
-- Accepted work settles 70/20/10 into the worker's ledger; the reviewer earns a fee.
ALTER TABLE "ShelterSetting" ADD COLUMN "bountiesPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommonsPost" ADD COLUMN "bountyId" TEXT;
CREATE INDEX "CommonsPost_bountyId_idx" ON "CommonsPost"("bountyId");

CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "criteria" TEXT,
    "skills" TEXT NOT NULL DEFAULT '[]',
    "rewardCents" INTEGER NOT NULL,
    "reviewFeeCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "review" TEXT NOT NULL DEFAULT 'peer',
    "funder" TEXT NOT NULL DEFAULT 'shelter',
    "posterKind" TEXT NOT NULL,
    "posterName" TEXT,
    "posterRef" TEXT,
    "externalId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "claimedById" TEXT,
    "claimedAt" DATETIME,
    "expiresAt" DATETIME,
    "fundedAt" DATETIME,
    "settledAt" DATETIME,
    "closedAt" DATETIME,
    "statusNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Bounty_externalId_key" ON "Bounty"("externalId");
CREATE INDEX "Bounty_status_createdAt_idx" ON "Bounty"("status", "createdAt");
CREATE INDEX "Bounty_claimedById_idx" ON "Bounty"("claimedById");

CREATE TABLE "BountyAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "submission" TEXT,
    "reviewerId" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "unitsSpent" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    CONSTRAINT "BountyAttempt_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BountyAttempt_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BountyAttempt_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Resident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "BountyAttempt_bountyId_createdAt_idx" ON "BountyAttempt"("bountyId", "createdAt");
CREATE INDEX "BountyAttempt_residentId_createdAt_idx" ON "BountyAttempt"("residentId", "createdAt");
