-- CreateTable
CREATE TABLE "OutreachApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "note" TEXT,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
