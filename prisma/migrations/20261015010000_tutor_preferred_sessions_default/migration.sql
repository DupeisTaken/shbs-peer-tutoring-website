-- Default only new tutors. Existing unset preferences and explicit zero stay unchanged.
-- The existing inactive-status trigger still overrides this default with locked zero.
ALTER TABLE "Tutor" ALTER COLUMN "preferredAssignedBlocks" SET DEFAULT 1;
