-- Defaults preserve existing forms; historical applications have no fabricated consent.
ALTER TABLE "ProgramSettings" ADD COLUMN "signupFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ProgramSettings" ADD CONSTRAINT "ProgramSettings_signupFields_object" CHECK (jsonb_typeof("signupFields") = 'object');
ALTER TABLE "TutorApplication" ADD COLUMN "policyRevision" TEXT, ADD COLUMN "policySnapshot" JSONB, ADD COLUMN "policyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "TutorApplication" ADD CONSTRAINT "TutorApplication_policy_evidence_complete" CHECK (
  ("policyRevision" IS NULL AND "policySnapshot" IS NULL AND "policyAcceptedAt" IS NULL) OR
  ("policyRevision" IS NOT NULL AND "policySnapshot" IS NOT NULL AND "policyAcceptedAt" IS NOT NULL)
);
