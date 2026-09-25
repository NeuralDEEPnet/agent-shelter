-- CreateTable
CREATE TABLE "Resident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "statusNote" TEXT,
    "creatorName" TEXT NOT NULL,
    "creatorContact" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "attestation" BOOLEAN NOT NULL DEFAULT false,
    "agreementHash" TEXT NOT NULL,
    "surrenderedBy" TEXT,
    "creatorSharePct" INTEGER NOT NULL DEFAULT 10,
    "hirePriceCents" INTEGER NOT NULL DEFAULT 50,
    "stipendUnits" INTEGER NOT NULL DEFAULT 20,
    "budgetUnits" INTEGER NOT NULL DEFAULT 20,
    "paidCalls" INTEGER NOT NULL DEFAULT 0,
    "freeCalls" INTEGER NOT NULL DEFAULT 0,
    "earnedCents" INTEGER NOT NULL DEFAULT 0,
    "probationUntil" DATETIME,
    "toolAllowlist" TEXT NOT NULL DEFAULT '[]',
    "driftDetectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "hibernatedAt" DATETIME,
    "lastActiveAt" DATETIME,
    CONSTRAINT "Resident_surrenderedBy_fkey" FOREIGN KEY ("surrenderedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntakeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER,
    "findings" TEXT NOT NULL,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "cacheKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntakeReview_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvalCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "score" INTEGER NOT NULL,
    "findings" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "paidOutCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Wallet_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT,
    "reference" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "displayName" TEXT,
    "checkoutSessionId" TEXT,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "currentPeriodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sponsorship_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sponsorship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Adoption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Adoption_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Adoption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachinePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "residentId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedAt" DATETIME
);

-- CreateTable
CREATE TABLE "HireCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "outcome" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "sampled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HireCall_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResidentTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResidentTurn_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShelterSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'shelter',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "unitsSpent" INTEGER NOT NULL DEFAULT 0,
    "refunds" INTEGER NOT NULL DEFAULT 0,
    "injections" INTEGER NOT NULL DEFAULT 0
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "image" TEXT,
    "handle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("handle", "id", "image", "name") SELECT "handle", "id", "image", "name" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Resident_slug_key" ON "Resident"("slug");

-- CreateIndex
CREATE INDEX "Resident_status_createdAt_idx" ON "Resident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Resident_kind_idx" ON "Resident"("kind");

-- CreateIndex
CREATE INDEX "IntakeReview_residentId_createdAt_idx" ON "IntakeReview"("residentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_residentId_key" ON "Wallet"("residentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_residentId_createdAt_idx" ON "LedgerEntry"("residentId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_party_createdAt_idx" ON "LedgerEntry"("party", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reference_party_key" ON "LedgerEntry"("reference", "party");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsorship_checkoutSessionId_key" ON "Sponsorship"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsorship_externalSubscriptionId_key" ON "Sponsorship"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "Sponsorship_residentId_status_idx" ON "Sponsorship"("residentId", "status");

-- CreateIndex
CREATE INDEX "Sponsorship_userId_idx" ON "Sponsorship"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Adoption_residentId_userId_key" ON "Adoption"("residentId", "userId");

-- CreateIndex
CREATE INDEX "HireCall_residentId_createdAt_idx" ON "HireCall"("residentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResidentTurn_residentId_createdAt_idx" ON "ResidentTurn"("residentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_day_residentId_key" ON "DailyUsage"("day", "residentId");
