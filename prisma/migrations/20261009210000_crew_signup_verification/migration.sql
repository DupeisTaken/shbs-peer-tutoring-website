-- Pending drafts/challenges are separate from the durable, administrator-reviewed application.
CREATE TABLE "CrewSignupVerification" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "draft" JSONB,
    "applicationId" TEXT,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrewSignupVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrewSignupVerification_email_key" ON "CrewSignupVerification"("email");
CREATE INDEX "CrewSignupVerification_applicationId_idx" ON "CrewSignupVerification"("applicationId");
CREATE INDEX "CrewSignupVerification_codeExpiresAt_idx" ON "CrewSignupVerification"("codeExpiresAt");
