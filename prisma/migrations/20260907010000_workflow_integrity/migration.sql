-- Nullable fingerprints preserve imported history while new submissions gain retry protection.
ALTER TABLE "Session" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "Session_submissionKey_key" ON "Session"("submissionKey");
ALTER TABLE "TuteeRemovalRequest" ADD COLUMN "pairingSnapshot" JSONB;
