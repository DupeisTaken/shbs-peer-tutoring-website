-- Existing holidays/make-up days retain their school-day meaning without inventing a timetable.
ALTER TABLE "SchoolCalendarDay"
  ADD COLUMN "timetableWeekday" INTEGER,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SchoolCalendarDay"
  ADD CONSTRAINT "SchoolCalendarDay_timetableWeekday_check"
    CHECK ("timetableWeekday" IS NULL OR "timetableWeekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "SchoolCalendarDay_closed_timetable_check"
    CHECK ("isSchoolDay" OR "timetableWeekday" IS NULL),
  ADD CONSTRAINT "SchoolCalendarDay_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "SchoolCalendarDay_scheduleRevision_check" CHECK ("scheduleRevision" > 0);
