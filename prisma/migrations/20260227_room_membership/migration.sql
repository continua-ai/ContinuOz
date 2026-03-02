-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "invitedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomMember_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_roomId_userId_key" ON "RoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RoomMember_userId_idx" ON "RoomMember"("userId");

-- CreateIndex
CREATE INDEX "RoomMember_roomId_idx" ON "RoomMember"("roomId");

-- Backfill existing room owners into membership
INSERT INTO "RoomMember" ("id", "roomId", "userId", "role", "invitedByUserId", "createdAt")
SELECT
    lower(hex(randomblob(16))),
    "Room"."id",
    "Room"."userId",
    'OWNER',
    NULL,
    CURRENT_TIMESTAMP
FROM "Room"
WHERE "Room"."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "RoomMember"
    WHERE "RoomMember"."roomId" = "Room"."id"
      AND "RoomMember"."userId" = "Room"."userId"
  );
