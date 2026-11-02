ALTER TABLE "User" ADD COLUMN "refreshAuthorityRevision" INTEGER NOT NULL DEFAULT 0;

-- Every authoritative writer participates, including leadership transfer and recovery.
-- Restoring a prior role/restriction never restores an old deferred authorization.
CREATE FUNCTION "advance_refresh_authority_revision"() RETURNS trigger AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt"
    OR NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" THEN
    NEW."refreshAuthorityRevision" := OLD."refreshAuthorityRevision" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_refresh_authority_revision"
  BEFORE UPDATE OF "role", "suspendedAt", "mergedIntoId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION "advance_refresh_authority_revision"();

CREATE TYPE "ScheduledRefreshState" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'BLOCKED', 'FAILED');

CREATE TABLE "ScheduledProgramRefresh" (
  "id" TEXT NOT NULL,
  "sourceTermId" TEXT NOT NULL,
  "sourceSchoolYear" TEXT NOT NULL,
  "sourceQuarter" "Quarter" NOT NULL,
  "destinationSchoolYear" TEXT NOT NULL,
  "destinationQuarter" "Quarter" NOT NULL,
  "semesterMode" BOOLEAN NOT NULL,
  "executeAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "state" "ScheduledRefreshState" NOT NULL DEFAULT 'SCHEDULED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expectedPreparation" JSONB NOT NULL,
  "authorizedById" TEXT NOT NULL,
  "authorityRevision" INTEGER NOT NULL,
  "authorizedByName" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "blockedReason" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledProgramRefresh_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledProgramRefresh_version_check" CHECK ("version" > 0),
  CONSTRAINT "ScheduledProgramRefresh_sourceTermId_fkey" FOREIGN KEY ("sourceTermId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduledProgramRefresh_sourceTermId_key" ON "ScheduledProgramRefresh"("sourceTermId");
CREATE INDEX "ScheduledProgramRefresh_state_executeAt_idx" ON "ScheduledProgramRefresh"("state", "executeAt");
