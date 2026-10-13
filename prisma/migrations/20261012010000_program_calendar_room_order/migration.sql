-- Keep the existing alphabetical program display while leaving crew patrol order intact.
ALTER TABLE "Room" ADD COLUMN "programOrder" INTEGER NOT NULL DEFAULT 0;
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY name, id) - 1 AS rank FROM "Room")
UPDATE "Room" r SET "programOrder" = ordered.rank FROM ordered WHERE r.id = ordered.id;

-- Informational only. Tombstones retain concurrency evidence across remove/recreate cycles.
CREATE TABLE "ProgramCalendarDay" (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

