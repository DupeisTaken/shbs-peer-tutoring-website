-- CreateEnum
CREATE TYPE "AcademicStatus" AS ENUM ('REPORTED', 'UNKNOWN', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "Tutor" ADD COLUMN     "gradeConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "gradeSchoolYear" TEXT;

-- CreateTable
CREATE TABLE "AcademicProfile" (
    "userId" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL DEFAULT 'UNKNOWN',
    "gradeLevel" INTEGER,
    "rawGrade" TEXT,
    "schoolYear" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "reconfirmRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AcademicProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AcademicConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AcademicStatus" NOT NULL,
    "gradeLevel" INTEGER,
    "rawGrade" TEXT,
    "schoolYear" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "source" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AcademicConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicConfirmation_userId_confirmedAt_idx" ON "AcademicConfirmation"("userId", "confirmedAt");

-- AddForeignKey
ALTER TABLE "AcademicProfile" ADD CONSTRAINT "AcademicProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicConfirmation" ADD CONSTRAINT "AcademicConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AcademicProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every pre-existing source verbatim without inventing a reference year.
-- Disagreement is explicit in rawGrade; no source wins merely because of membership type.
WITH sources AS (
 SELECT u.id, u."gradeLevel"::text AS account_grade, t."gradeLevel"::text AS tutor_grade,
   s."gradeLevel" AS student_grade
 FROM "User" u LEFT JOIN "Tutor" t ON t.id=u."tutorId" LEFT JOIN "Tutee" s ON s.id=u."studentId"
), legacy AS (
 SELECT id, COALESCE(student_grade, tutor_grade, account_grade) AS candidate,
   CASE WHEN (account_grade IS NOT NULL AND tutor_grade IS NOT NULL AND account_grade <> tutor_grade)
          OR (student_grade IS NOT NULL AND COALESCE(tutor_grade,account_grade) IS NOT NULL AND
              lower(regexp_replace(student_grade, '^(grade|g) *', '', 'i')) <> COALESCE(tutor_grade,account_grade))
     THEN concat_ws('; ', 'Account: ' || account_grade, 'Tutor: ' || tutor_grade, 'Enrollment: ' || student_grade)
     ELSE COALESCE(student_grade,tutor_grade,account_grade) END AS raw
 FROM sources
)
INSERT INTO "AcademicProfile" ("userId", status, "gradeLevel", "rawGrade", "reconfirmRequired")
SELECT id, 'UNKNOWN', CASE WHEN raw = candidate AND candidate ~* '^(grade *|g *)?([1-9]|1[0-2])$'
 THEN regexp_replace(candidate, '^(grade|g) *', '', 'i')::integer ELSE NULL END,
 raw, true FROM legacy;

ALTER TABLE "AcademicProfile" ADD CONSTRAINT "AcademicProfile_grade_range" CHECK ("gradeLevel" IS NULL OR "gradeLevel" BETWEEN 1 AND 12);
ALTER TABLE "AcademicConfirmation" ADD CONSTRAINT "AcademicConfirmation_grade_range" CHECK ("gradeLevel" IS NULL OR "gradeLevel" BETWEEN 1 AND 12);
