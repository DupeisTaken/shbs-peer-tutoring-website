-- CreateTable
CREATE TABLE "TutorQualification" (
    "tutorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorQualification_pkey" PRIMARY KEY ("tutorId","subjectId")
);
