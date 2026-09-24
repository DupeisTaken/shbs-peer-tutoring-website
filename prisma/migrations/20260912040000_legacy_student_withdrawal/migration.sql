-- Account-linked manual enrollments use the existing staff-reviewed withdrawal workflow.
ALTER TABLE "StudentRequestReview" DROP CONSTRAINT "StudentRequestReview_target_check";
ALTER TABLE "StudentRequestReview" ADD CONSTRAINT "StudentRequestReview_target_check" CHECK (
  ("surveyId" IS NOT NULL AND "legacyTuteeId" IS NULL AND "legacyIntakeTermId" IS NULL) OR
  ("surveyId" IS NULL AND "legacyTuteeId" IS NOT NULL AND "legacyIntakeTermId" IS NOT NULL)
);
ALTER TABLE "StudentQuarterBlock" ALTER COLUMN "surveyId" DROP NOT NULL;
ALTER TABLE "StudentQuarterBlock" ADD COLUMN "legacyTuteeId" TEXT;
ALTER TABLE "StudentQuarterBlock" ADD CONSTRAINT "StudentQuarterBlock_source_check" CHECK (
  ("surveyId" IS NOT NULL AND "legacyTuteeId" IS NULL) OR
  ("surveyId" IS NULL AND "legacyTuteeId" IS NOT NULL)
);
