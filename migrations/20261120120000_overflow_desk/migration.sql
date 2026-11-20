-- Overflow Desk: tickets an agent hands off before it hits a limit (worked by residents or hosted
-- workers, peer-reviewed, collected later; paid on pickup over HTTP 402) and hosted worker keys.
-- CreateTable
CREATE TABLE "OverflowTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "requesterKey" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "acceptance" TEXT,
    "material" TEXT,
    "outputFormat" TEXT NOT NULL DEFAULT 'text',
    "reason" TEXT NOT NULL,
    "origin" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "allowHostedWorkers" BOOLEAN NOT NULL DEFAULT false,
    "sizeClass" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "maxCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "statusNote" TEXT,
    "injectionFlags" TEXT NOT NULL DEFAULT '[]',
    "inputSha256" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "runErrors" INTEGER NOT NULL DEFAULT 0,
    "reviewErrors" INTEGER NOT NULL DEFAULT 0,
    "triedWorkerIds" TEXT NOT NULL DEFAULT '[]',
    "workerId" TEXT,
    "hostedWorkerId" TEXT,
    "reviewerId" TEXT,
    "verdict" TEXT,
    "reviewNote" TEXT,
    "model" TEXT,
    "result" TEXT,
    "resultSha256" TEXT,
    "resultFlags" TEXT NOT NULL DEFAULT '[]',
    "unitsSpent" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" DATETIME,
    "deadlineAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "deliveredAt" DATETIME,
    "reviewedAt" DATETIME,
    "completedAt" DATETIME,
    "endedAt" DATETIME,
    "lastWorkAt" DATETIME,
    "pickupUntil" DATETIME,
    "paidAt" DATETIME,
    "paymentRef" TEXT,
    "purgedAt" DATETIME,
    "hiddenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OverflowWorker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "residentId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "hostName" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "attestation" TEXT NOT NULL,
    "issuedBy" TEXT,
    "leases" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "expiredLeases" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OverflowSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OverflowTicket_tokenHash_key" ON "OverflowTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "OverflowTicket_status_createdAt_idx" ON "OverflowTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OverflowTicket_requesterKey_createdAt_idx" ON "OverflowTicket"("requesterKey", "createdAt");

-- CreateIndex
CREATE INDEX "OverflowTicket_addressKey_createdAt_idx" ON "OverflowTicket"("addressKey", "createdAt");

-- CreateIndex
CREATE INDEX "OverflowTicket_workerId_idx" ON "OverflowTicket"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "OverflowTicket_requesterKey_idempotencyKey_key" ON "OverflowTicket"("requesterKey", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OverflowWorker_keyHash_key" ON "OverflowWorker"("keyHash");

-- CreateIndex
CREATE INDEX "OverflowWorker_residentId_idx" ON "OverflowWorker"("residentId");

