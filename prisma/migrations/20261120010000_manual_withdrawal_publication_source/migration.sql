-- A manual enrollment can leave a shared publication while its peers retain
-- their accepted session. Preserve the exact source of the release without
-- inventing a survey or continuation assignment or modifying the saved roster.
BEGIN;
ALTER TABLE "SessionPlanContinuationMember"
  ADD COLUMN "sourceTuteeId" TEXT,
  DROP CONSTRAINT "SessionPlanContinuationMember_source_check",
  ADD CONSTRAINT "SessionPlanContinuationMember_source_check"
    CHECK (
      num_nonnulls("assignmentId", "sourceSurveyId", "sourceTuteeId") = 1
      AND ("sourceTuteeId" IS NULL OR "releasedAt" IS NOT NULL)
    );
COMMIT;
