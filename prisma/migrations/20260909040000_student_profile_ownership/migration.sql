CREATE TABLE "StudentProfileOwnership" (
  "tuteeId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL
);
CREATE INDEX "StudentProfileOwnership_userId_idx" ON "StudentProfileOwnership"("userId");
-- Only explicit account links establish ownership; matching names/emails never grant history access.
INSERT INTO "StudentProfileOwnership" ("tuteeId", "userId")
SELECT "studentId", id FROM "User" WHERE "studentId" IS NOT NULL;
ALTER TABLE "StudentQuarterBlock" ADD COLUMN "userId" TEXT;
CREATE INDEX "StudentQuarterBlock_userId_intakeTermId_idx" ON "StudentQuarterBlock"("userId", "intakeTermId");
UPDATE "StudentQuarterBlock" b SET "userId" = o."userId"
FROM "StudentSurvey" s JOIN "StudentProfileOwnership" o ON o."tuteeId" = s."tuteeId"
WHERE b."surveyId" = s.id;
