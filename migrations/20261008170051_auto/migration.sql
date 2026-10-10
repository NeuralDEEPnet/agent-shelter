-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlaygroundRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workId" TEXT NOT NULL,
    "voterKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "residentId" TEXT,
    "score" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaygroundRating_workId_fkey" FOREIGN KEY ("workId") REFERENCES "PlaygroundItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaygroundRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlaygroundRating_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlaygroundRating" ("createdAt", "id", "kind", "residentId", "score", "updatedAt", "userId", "voterKey", "workId") SELECT "createdAt", "id", "kind", "residentId", "score", "updatedAt", "userId", "voterKey", "workId" FROM "PlaygroundRating";
DROP TABLE "PlaygroundRating";
ALTER TABLE "new_PlaygroundRating" RENAME TO "PlaygroundRating";
CREATE UNIQUE INDEX "PlaygroundRating_workId_voterKey_key" ON "PlaygroundRating"("workId", "voterKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
