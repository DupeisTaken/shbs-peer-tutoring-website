-- Accepted-public-intake counters are shared by server replicas and survive restarts.
-- Existing applications and their review/notification history are left untouched.
CREATE TABLE "PublicApplicationRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetsAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicApplicationRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "PublicApplicationRateLimit_resetsAt_idx" ON "PublicApplicationRateLimit"("resetsAt");
