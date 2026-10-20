-- Keep outstanding deterministic mailbox challenges on their issued format.
-- New issuance explicitly selects version 1; existing rows remain legacy version 0.
ALTER TABLE "StudentSurvey" ADD COLUMN "emailCodeVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StudentSignupIntent" ADD COLUMN "emailCodeVersion" INTEGER NOT NULL DEFAULT 0;
