-- Preserve every legacy patrol, its evidence and its hour total. Past award time is
-- conservatively the recorded submission time; no new historical hours are invented.
ALTER TABLE "Patrol" ADD COLUMN "creditAwardedAt" TIMESTAMP(3);
UPDATE "Patrol" SET "creditAwardedAt" = "createdAt" WHERE "hours" > 0;
CREATE INDEX "Patrol_crewUserId_creditAwardedAt_idx" ON "Patrol"("crewUserId", "creditAwardedAt");

CREATE TABLE "PatrolCreditWindow" (
  "crewUserId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "patrolId" TEXT NOT NULL,
  CONSTRAINT "PatrolCreditWindow_pkey" PRIMARY KEY ("crewUserId", "windowStart"),
  CONSTRAINT "PatrolCreditWindow_crewUserId_fkey" FOREIGN KEY ("crewUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatrolCreditWindow_patrolId_fkey" FOREIGN KEY ("patrolId") REFERENCES "Patrol"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatrolCreditWindow_aligned" CHECK (
    "windowStart" = date_bin(INTERVAL '20 minutes', "windowStart", TIMESTAMP '1970-01-01')
  )
);
CREATE INDEX "PatrolCreditWindow_patrolId_idx" ON "PatrolCreditWindow"("patrolId");

-- Timestamps are stored as UTC instants without a SQL timezone. Match the application's
-- epoch-aligned 20-minute windows. For overlapping legacy awards reserve once for the
-- earliest submission, without deleting duplicates or retrospectively deducting hours.
-- A legacy patrol without observations reserves its submission interval as a fallback.
INSERT INTO "PatrolCreditWindow" ("crewUserId", "windowStart", "patrolId")
SELECT DISTINCT ON (p."crewUserId", date_bin(INTERVAL '20 minutes', COALESCE(o."observedAt", p."createdAt"), TIMESTAMP '1970-01-01'))
  p."crewUserId",
  date_bin(INTERVAL '20 minutes', COALESCE(o."observedAt", p."createdAt"), TIMESTAMP '1970-01-01'),
  p."id"
FROM "Patrol" p
LEFT JOIN "PatrolObservation" o ON o."patrolId" = p."id"
WHERE p."hours" > 0
ORDER BY p."crewUserId", date_bin(INTERVAL '20 minutes', COALESCE(o."observedAt", p."createdAt"), TIMESTAMP '1970-01-01'), p."createdAt", p."id";
