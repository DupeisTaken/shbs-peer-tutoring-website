-- Additive envelope: outstanding staff codes, request links and historical invitations retain
-- their original authorization, expiry and evidence. No account or membership is backfilled.
CREATE TABLE "AccountInvitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "accountId" TEXT,
  "sessionVersion" INTEGER,
  "loginUsedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedUserId" TEXT,
  "receipt" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AccountInvitation_sourceKey_key" ON "AccountInvitation"("sourceKey");
CREATE INDEX "AccountInvitation_email_createdAt_idx" ON "AccountInvitation"("email", "createdAt");
CREATE INDEX "AccountInvitation_expiresAt_idx" ON "AccountInvitation"("expiresAt");
