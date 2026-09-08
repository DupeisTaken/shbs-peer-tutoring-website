ALTER TYPE "Role" ADD VALUE 'STUDENT';
ALTER TABLE "Tutee" ADD COLUMN "intakeTermId" TEXT;
ALTER TABLE "User" ADD COLUMN "studentId" TEXT;
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
ALTER TABLE "User" ADD CONSTRAINT "User_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Tutee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tutee" ADD COLUMN "signupSubmittedAt" TIMESTAMP(3);
UPDATE "Tutee" SET "signupSubmittedAt" = COALESCE("signedAt", "createdAt") WHERE "intakeTermId" IS NOT NULL;
CREATE TABLE "StudentSurvey" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "intakeTermId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "policyRevision" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "StudentSurvey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentSurvey_tokenHash_key" ON "StudentSurvey"("tokenHash");
CREATE UNIQUE INDEX "StudentSurvey_email_intakeTermId_key" ON "StudentSurvey"("email", "intakeTermId");

CREATE TABLE "PolicyAcceptance" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "slug" TEXT NOT NULL,
 "revision" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "signature" TEXT NOT NULL,
 "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PolicyAcceptance_userId_slug_revision_key" ON "PolicyAcceptance"("userId", "slug", "revision");
