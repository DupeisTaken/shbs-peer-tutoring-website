CREATE TYPE "StudentSurveyState" AS ENUM ('OPEN', 'RECALLED', 'DISQUALIFIED', 'ABORTED');
CREATE TYPE "StudentReviewKind" AS ENUM ('STUDENT_ABORT', 'SCHEDULE_CONFLICT');
DROP INDEX "StudentSurvey_email_intakeTermId_key";
ALTER TABLE "StudentSurvey" ADD COLUMN "state" "StudentSurveyState" NOT NULL DEFAULT 'OPEN',
 ADD COLUMN "tuteeId" TEXT, ADD COLUMN "firstAssignedAt" TIMESTAMP(3),
 ADD COLUMN "verificationDueAt" TIMESTAMP(3), ADD COLUMN "editedAt" TIMESTAMP(3),
 ADD COLUMN "resolvedAt" TIMESTAMP(3), ADD COLUMN "lastLinkSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "StudentSurvey_tuteeId_key" ON "StudentSurvey"("tuteeId");
CREATE INDEX "StudentSurvey_email_intakeTermId_submittedAt_idx" ON "StudentSurvey"("email", "intakeTermId", "submittedAt");
CREATE INDEX "StudentSurvey_state_confirmedAt_verificationDueAt_idx" ON "StudentSurvey"("state", "confirmedAt", "verificationDueAt");
-- Prisma has no portable partial-unique declaration; closed history may coexist with one open request.
CREATE UNIQUE INDEX "StudentSurvey_one_open_request" ON "StudentSurvey"("email", "intakeTermId") WHERE "state" = 'OPEN';
UPDATE "StudentSurvey" s SET "tuteeId" = u."studentId" FROM "User" u JOIN "Tutee" t ON t.id = u."studentId"
 WHERE s.email = u.email AND s."intakeTermId" = t."intakeTermId" AND s."confirmedAt" IS NOT NULL;
CREATE TABLE "StudentRequestReview" (
 "id" TEXT PRIMARY KEY, "surveyId" TEXT NOT NULL REFERENCES "StudentSurvey"("id"),
 "kind" "StudentReviewKind" NOT NULL, "requestedByUserId" TEXT NOT NULL, "pairingId" TEXT,
 "reason" TEXT NOT NULL, "state" "TuteeRequestState" NOT NULL DEFAULT 'PENDING',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3), "resolvedByUserId" TEXT
);
CREATE INDEX "StudentRequestReview_state_createdAt_idx" ON "StudentRequestReview"("state", "createdAt");
CREATE TABLE "StudentQuarterBlock" (
 "id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "intakeTermId" TEXT NOT NULL, "surveyId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StudentQuarterBlock_email_intakeTermId_key" ON "StudentQuarterBlock"("email", "intakeTermId");
CREATE TABLE "StudentActionConfirmation" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "action" TEXT NOT NULL, "target" TEXT NOT NULL,
 "readyAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3)
);
CREATE INDEX "StudentActionConfirmation_expiresAt_idx" ON "StudentActionConfirmation"("expiresAt");

-- Legacy admin editors and undo operations cannot reactivate terminal survey requests.
CREATE FUNCTION protect_student_request_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR
    (OLD.state <> 'OPEN' AND NEW.state IS DISTINCT FROM OLD.state) THEN
   RAISE EXCEPTION 'Request priority and terminal state cannot be changed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_request_history BEFORE UPDATE ON "StudentSurvey" FOR EACH ROW EXECUTE FUNCTION protect_student_request_history();
CREATE FUNCTION protect_closed_student_roster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id TEXT;
BEGIN
 IF TG_TABLE_NAME = 'Tutee' THEN
   IF NEW.status = 'INACTIVE' THEN RETURN NEW; END IF;
   target_id := NEW.id;
 ELSE target_id := NEW."tuteeId";
 END IF;
 IF EXISTS (SELECT 1 FROM "StudentSurvey" WHERE "tuteeId" = target_id AND
   (state <> 'OPEN' OR ("confirmedAt" IS NULL AND "verificationDueAt" <= CURRENT_TIMESTAMP))) THEN
   RAISE EXCEPTION 'Closed or expired student request cannot be assigned or reactivated';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_roster_status BEFORE UPDATE ON "Tutee" FOR EACH ROW EXECUTE FUNCTION protect_closed_student_roster();
CREATE TRIGGER student_roster_pairing BEFORE INSERT OR UPDATE ON "PairingTutee" FOR EACH ROW EXECUTE FUNCTION protect_closed_student_roster();
