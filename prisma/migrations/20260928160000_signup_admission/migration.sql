-- Dedicated, bounded abuse accounting. Never clean up valid participant records as quotas.
CREATE TABLE "SignupQuota" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "SignupQuota_expiresAt_idx" ON "SignupQuota"("expiresAt");
CREATE TABLE "SignupLease" ("slot" TEXT PRIMARY KEY, "owner" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
