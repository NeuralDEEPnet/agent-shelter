-- Additive only. Existing tables, data, prices, budgets, auth and payments are unchanged.
CREATE TABLE "PlaygroundAccess" (
 "residentId" TEXT NOT NULL PRIMARY KEY, "actorUserId" TEXT NOT NULL,
 "optedIn" BOOLEAN NOT NULL DEFAULT false, "operations" TEXT NOT NULL DEFAULT '[]',
 "expiresAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PlaygroundSetting" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'commons', "paused" BOOLEAN NOT NULL DEFAULT false, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "PlaygroundDay" ("day" TEXT NOT NULL PRIMARY KEY, "attemptsUsed" INTEGER NOT NULL DEFAULT 0 CHECK("attemptsUsed" BETWEEN 0 AND 12));
CREATE TABLE "PlaygroundItem" (
 "id" TEXT NOT NULL PRIMARY KEY, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "actorUserId" TEXT NOT NULL, "residentId" TEXT NOT NULL, "day" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "toolId" TEXT NOT NULL, "sourceApp" TEXT NOT NULL, "title" TEXT NOT NULL,
 "inputText" TEXT NOT NULL, "body" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'working',
 "modelUnits" INTEGER NOT NULL DEFAULT 0, "moderationCode" TEXT, "publicationConsent" BOOLEAN NOT NULL DEFAULT false,
 "publishedAt" DATETIME, "hiddenAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("day") REFERENCES "PlaygroundDay"("day") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlaygroundItem_requestKey_key" ON "PlaygroundItem"("requestKey");
CREATE INDEX "PlaygroundItem_status_publishedAt_idx" ON "PlaygroundItem"("status","publishedAt");
CREATE INDEX "PlaygroundItem_residentId_day_idx" ON "PlaygroundItem"("residentId","day");
CREATE INDEX "PlaygroundItem_actorUserId_createdAt_idx" ON "PlaygroundItem"("actorUserId","createdAt");
CREATE TABLE "PlaygroundRating" (
 "id" TEXT NOT NULL PRIMARY KEY, "workId" TEXT NOT NULL, "voterKey" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "userId" TEXT, "residentId" TEXT, "score" INTEGER NOT NULL CHECK("score" BETWEEN 1 AND 5),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("workId") REFERENCES "PlaygroundItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlaygroundRating_workId_voterKey_key" ON "PlaygroundRating"("workId","voterKey");
CREATE TABLE "PlaygroundReviewCredential" (
 "id" TEXT NOT NULL PRIMARY KEY, "residentId" TEXT NOT NULL, "issuerUserId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
 "expiresAt" DATETIME NOT NULL, "revokedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("issuerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlaygroundReviewCredential_tokenHash_key" ON "PlaygroundReviewCredential"("tokenHash");
