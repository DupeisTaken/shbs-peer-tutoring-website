-- Existing announcements retain broadcast visibility. New posts explicitly opt into snapshots.
ALTER TABLE "Announcement"
  ADD COLUMN "audienceRestricted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recipientTutorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
