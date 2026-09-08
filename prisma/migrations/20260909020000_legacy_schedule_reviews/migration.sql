ALTER TABLE "StudentRequestReview" ALTER COLUMN "surveyId" DROP NOT NULL;
ALTER TABLE "StudentRequestReview" ADD COLUMN "legacyTuteeId" TEXT, ADD COLUMN "legacyIntakeTermId" TEXT;
ALTER TABLE "StudentRequestReview" ADD CONSTRAINT "StudentRequestReview_target_check" CHECK (
 ("surveyId" IS NOT NULL AND "legacyTuteeId" IS NULL AND "legacyIntakeTermId" IS NULL) OR
 ("surveyId" IS NULL AND "legacyTuteeId" IS NOT NULL AND "legacyIntakeTermId" IS NOT NULL AND kind = 'SCHEDULE_CONFLICT')
);
