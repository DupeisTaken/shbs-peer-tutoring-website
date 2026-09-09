-- CreateTable
CREATE TABLE "SchoolCalendarDay" (
    "date" TEXT NOT NULL,
    "isSchoolDay" BOOLEAN NOT NULL,
    "note" TEXT,

    CONSTRAINT "SchoolCalendarDay_pkey" PRIMARY KEY ("date")
);
