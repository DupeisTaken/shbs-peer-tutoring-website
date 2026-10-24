-- Preparation is separate from Term so drafts never appear as activated history.
ALTER TABLE "ProgramFeature" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Term" ADD COLUMN "nextRecruitmentRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TYPE "RecruitmentAudience" AS ENUM ('tutor', 'tutee');
CREATE TABLE "NextRecruitmentPreparation" (
    "sourceTermId" TEXT NOT NULL,
    "audience" "RecruitmentAudience" NOT NULL,
    "sourceSchoolYear" TEXT NOT NULL,
    "sourceQuarter" "Quarter" NOT NULL,
    "destinationSchoolYear" TEXT NOT NULL,
    "destinationQuarter" "Quarter" NOT NULL,
    "semesterMode" BOOLEAN NOT NULL,
    "modeRevision" INTEGER NOT NULL,
    "opensAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NextRecruitmentPreparation_pkey" PRIMARY KEY ("sourceTermId", "audience"),
    CONSTRAINT "NextRecruitmentPreparation_version_check" CHECK ("version" > 0),
    CONSTRAINT "NextRecruitmentPreparation_modeRevision_check" CHECK ("modeRevision" >= 0)
);
ALTER TABLE "NextRecruitmentPreparation" ADD CONSTRAINT "NextRecruitmentPreparation_sourceTermId_fkey"
    FOREIGN KEY ("sourceTermId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
