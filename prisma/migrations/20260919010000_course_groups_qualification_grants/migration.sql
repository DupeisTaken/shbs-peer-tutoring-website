ALTER TABLE "SubjectLevel" ADD COLUMN "prefix" TEXT NOT NULL DEFAULT '';
UPDATE "SubjectLevel" SET "prefix" = CASE WHEN lower(trim(name)) = 'standard' THEN '' ELSE trim(name) END;

CREATE TABLE "CourseGroup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "Subject" ADD COLUMN "baseName" TEXT NOT NULL DEFAULT '', ADD COLUMN "groupId" TEXT;

-- Never infer equivalence from similar names: each legacy course starts in its own group.
-- Keep all subject IDs and labels intact (including nonstandard legacy labels).
INSERT INTO "CourseGroup" (id, name, rank, "createdAt")
SELECT 'legacy_' || id, name, row_number() OVER (ORDER BY name, id)::integer - 1, "createdAt" FROM "Subject";
UPDATE "Subject" s SET "groupId" = 'legacy_' || s.id, "baseName" =
  CASE WHEN l.prefix <> '' AND left(s.name, length(l.prefix) + 1) = l.prefix || ' '
    THEN substring(s.name FROM length(l.prefix) + 2) ELSE s.name END
FROM "SubjectLevel" l WHERE s."levelId" = l.id;
UPDATE "Subject" SET "groupId" = 'legacy_' || id, "baseName" = name WHERE "groupId" IS NULL;
CREATE UNIQUE INDEX "Subject_groupId_levelId_key" ON "Subject"("groupId", "levelId");
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CourseGroup"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "QualificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "TutorQualification" ADD COLUMN "status" "QualificationStatus" NOT NULL DEFAULT 'APPROVED';
CREATE TABLE "QualificationGrant" (
  "tutorId" TEXT NOT NULL,
  "sourceSubjectId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualificationGrant_pkey" PRIMARY KEY ("tutorId", "sourceSubjectId", "subjectId"),
  CONSTRAINT "QualificationGrant_tutorId_sourceSubjectId_fkey" FOREIGN KEY ("tutorId", "sourceSubjectId") REFERENCES "TutorQualification"("tutorId", "subjectId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QualificationGrant_tutorId_subjectId_idx" ON "QualificationGrant"("tutorId", "subjectId");
-- Legacy rows are explicit staff approvals. Preserve EXACT eligibility, never infer new grants.
INSERT INTO "QualificationGrant" ("tutorId", "sourceSubjectId", "subjectId", "grantedAt")
SELECT "tutorId", "subjectId", "subjectId", "createdAt" FROM "TutorQualification";
