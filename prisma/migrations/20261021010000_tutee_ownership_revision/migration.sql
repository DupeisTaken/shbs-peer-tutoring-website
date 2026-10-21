-- Preserve existing retained owners while giving future transfers a monotonic
-- review version; an A-to-B-to-A correction must not revive an older preview.
ALTER TABLE "StudentProfileOwnership"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
