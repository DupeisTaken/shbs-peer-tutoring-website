-- Additive only: archived participation and existing invitations stay intact.
ALTER TABLE "TuteeHistoryInvitation"
  ADD COLUMN "setupCodeHash" TEXT,
  ADD COLUMN "setupCodeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "setupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "setupVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "setupUserId" TEXT;
