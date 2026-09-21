-- Willingness is explicit participant intent; existing approvals and interviews
-- cannot establish it. Intentionally do not backfill from any historical records.
CREATE TABLE "TutorSubjectWillingness" (
    "tutorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "willing" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TutorSubjectWillingness_pkey" PRIMARY KEY ("tutorId", "subjectId"),
    CONSTRAINT "TutorSubjectWillingness_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TutorSubjectWillingness_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TutorSubjectWillingness_subjectId_willing_idx" ON "TutorSubjectWillingness"("subjectId", "willing");
