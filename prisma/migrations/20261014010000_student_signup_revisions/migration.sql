-- Keep original submission/consent evidence and existing address/term ownership constraints.
-- These additive columns expose no new edit, eligibility, deadline or invitation permissions.
ALTER TABLE "StudentSurvey"
  ADD COLUMN "currentPayload" JSONB,
  ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "StudentSurvey_current_answers_check" CHECK (
    ("currentPayload" IS NULL AND "currentVersion" = 0) OR
    ("currentPayload" IS NOT NULL AND jsonb_typeof("currentPayload") = 'object' AND "currentVersion" > 0)
  );

CREATE TABLE "StudentSignupRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "surveyId" TEXT NOT NULL REFERENCES "StudentSurvey"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "expectedVersion" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorUserName" TEXT,
  "clientKey" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inputHash" TEXT NOT NULL,
  "answers" JSONB NOT NULL,
  "policyRevision" TEXT,
  "policySnapshot" JSONB,
  "signatureName" TEXT,
  "policyAcceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentSignupRevision_version_check" CHECK (
    "expectedVersion" >= 0 AND "version" = "expectedVersion" + 1
  ),
  CONSTRAINT "StudentSignupRevision_answers_check" CHECK (jsonb_typeof("answers") = 'object'),
  CONSTRAINT "StudentSignupRevision_hash_check" CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "StudentSignupRevision_policy_check" CHECK (
    ("policyRevision" IS NULL AND "policySnapshot" IS NULL AND "signatureName" IS NULL AND "policyAcceptedAt" IS NULL) OR
    ("policyRevision" IS NOT NULL AND "policySnapshot" IS NOT NULL AND "signatureName" IS NOT NULL AND "policyAcceptedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "StudentSignupRevision_surveyId_version_key" ON "StudentSignupRevision"("surveyId", "version");
CREATE UNIQUE INDEX "StudentSignupRevision_surveyId_actorUserId_clientKey_key" ON "StudentSignupRevision"("surveyId", "actorUserId", "clientKey");
CREATE INDEX "StudentSignupRevision_actorUserId_createdAt_idx" ON "StudentSignupRevision"("actorUserId", "createdAt");

CREATE TABLE "StudentSignupIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "keyHash" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "accountId" TEXT,
  "sessionVersion" INTEGER,
  "surveyId" TEXT NOT NULL REFERENCES "StudentSurvey"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "expectedVersion" INTEGER NOT NULL CHECK ("expectedVersion" >= 0),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
  "policySnapshot" JSONB NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailSentAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedUserId" TEXT,
  "resultVersion" INTEGER
);
CREATE UNIQUE INDEX "StudentSignupIntent_keyHash_key" ON "StudentSignupIntent"("keyHash");
CREATE UNIQUE INDEX "StudentSignupIntent_tokenHash_key" ON "StudentSignupIntent"("tokenHash");
CREATE INDEX "StudentSignupIntent_email_receivedAt_idx" ON "StudentSignupIntent"("email", "receivedAt");

-- Shared account/profile and request tools must not overwrite the source evidence while editing.
CREATE FUNCTION protect_student_signup_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."payload" IS DISTINCT FROM OLD."payload" OR
     NEW."policyRevision" IS DISTINCT FROM OLD."policyRevision" OR
     NEW."policySnapshot" IS DISTINCT FROM OLD."policySnapshot" THEN
    RAISE EXCEPTION 'Original student signup and policy evidence cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_signup_original BEFORE UPDATE ON "StudentSurvey"
  FOR EACH ROW EXECUTE FUNCTION protect_student_signup_original();

CREATE FUNCTION protect_student_signup_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Student signup revision evidence cannot be changed or deleted';
END $$;
CREATE TRIGGER student_signup_revision BEFORE UPDATE OR DELETE ON "StudentSignupRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_student_signup_revision();
