ALTER TYPE "AcademicStatus" ADD VALUE 'GRADUATED';

ALTER TABLE "Tutor" ADD COLUMN "academicallyGraduated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tutee" ADD COLUMN "academicallyGraduated" BOOLEAN NOT NULL DEFAULT false;
