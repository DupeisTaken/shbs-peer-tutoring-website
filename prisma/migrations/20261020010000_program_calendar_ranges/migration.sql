-- Existing notices and tombstones retain their identity, version and one-day meaning.
ALTER TABLE "ProgramCalendarDay" ADD COLUMN "endDate" TEXT;
UPDATE "ProgramCalendarDay" SET "endDate" = date;
ALTER TABLE "ProgramCalendarDay" ALTER COLUMN "endDate" SET NOT NULL;
