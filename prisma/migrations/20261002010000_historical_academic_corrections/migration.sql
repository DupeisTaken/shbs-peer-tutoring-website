-- Preserve original archive rows. Historical evidence has exactly one participant;
-- no accounts, current-year reports, or fabricated confirmation dates are backfilled.
CREATE TABLE "HistoricalAcademicRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tutorId" TEXT,
    "tuteeId" TEXT,
    "rawGrade" TEXT,
    "academicallyGraduated" BOOLEAN NOT NULL DEFAULT false,
    "schoolYear" TEXT,
    "source" TEXT NOT NULL,
    "originalConfirmedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalAcademicRecord_participant_check" CHECK (num_nonnulls("tutorId", "tuteeId") = 1),
    CONSTRAINT "HistoricalAcademicRecord_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HistoricalAcademicRecord_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HistoricalAcademicRecord_tutorId_idx" ON "HistoricalAcademicRecord"("tutorId");
CREATE INDEX "HistoricalAcademicRecord_tuteeId_idx" ON "HistoricalAcademicRecord"("tuteeId");
CREATE TABLE "HistoricalAcademicCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL CHECK ("revision" > 0),
    "rawGrade" TEXT,
    "schoolYear" TEXT,
    "evidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "approvalId" TEXT,
    "method" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB NOT NULL,
    CONSTRAINT "HistoricalAcademicCorrection_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "HistoricalAcademicRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HistoricalAcademicCorrection_recordId_revision_key" ON "HistoricalAcademicCorrection"("recordId", "revision");
