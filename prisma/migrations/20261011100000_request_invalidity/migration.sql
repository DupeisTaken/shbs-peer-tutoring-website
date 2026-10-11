-- Additive review metadata: existing requests retain their lifecycle, priority and evidence.
ALTER TABLE "TutorApplication"
  ADD COLUMN "invalidReason" TEXT,
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "invalidatedById" TEXT,
  ADD COLUMN "invalidatedByName" TEXT,
  ADD COLUMN "invalidityVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StudentSurvey"
  ADD COLUMN "invalidReason" TEXT,
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "invalidatedById" TEXT,
  ADD COLUMN "invalidatedByName" TEXT,
  ADD COLUMN "invalidityVersion" INTEGER NOT NULL DEFAULT 0;
-- Scalar identity deliberately retains review evidence after an old roster record is deleted.
CREATE TABLE "TuteeRequestInvalidity" (
  "tuteeId" TEXT NOT NULL PRIMARY KEY,
  "invalidReason" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedById" TEXT,
  "invalidatedByName" TEXT,
  "invalidityVersion" INTEGER NOT NULL DEFAULT 0
);
