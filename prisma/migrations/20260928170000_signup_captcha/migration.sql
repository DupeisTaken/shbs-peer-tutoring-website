ALTER TABLE "ProgramSettings" ADD COLUMN "captchaEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "captchaVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "CaptchaProof" ("key" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "CaptchaProof_expiresAt_idx" ON "CaptchaProof"("expiresAt");
CREATE TABLE "CaptchaGrant" ("tokenHash" TEXT PRIMARY KEY, "action" TEXT NOT NULL, "identityHash" TEXT NOT NULL, "scene" TEXT NOT NULL, "version" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "CaptchaGrant_expiresAt_idx" ON "CaptchaGrant"("expiresAt");
