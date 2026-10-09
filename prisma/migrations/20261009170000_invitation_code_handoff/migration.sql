ALTER TABLE "AccountInvitation" ADD COLUMN "displayedCode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailCodeHash" TEXT,
  ADD COLUMN "emailCodeExpiresAt" TIMESTAMP(3);
CREATE INDEX "AccountInvitation_codeHash_idx" ON "AccountInvitation"("codeHash");
ALTER TABLE "StudentSurvey" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;
