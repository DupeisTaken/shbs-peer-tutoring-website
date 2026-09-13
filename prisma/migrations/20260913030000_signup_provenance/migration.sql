-- Storage outside StudentSurvey does not prove staff entry: older public signup
-- implementations also created Tutee rows. Preserve unknown historical provenance.
CREATE TYPE "SignupSource" AS ENUM ('UNKNOWN', 'STAFF', 'SELF_SERVICE');
ALTER TABLE "Tutee" ADD COLUMN "signupSource" "SignupSource" NOT NULL DEFAULT 'UNKNOWN';

-- An explicit survey/profile link is source evidence. Names, email, signatures,
-- account links and inferred timestamps are deliberately not used for attribution.
UPDATE "Tutee" AS t SET "signupSource" = 'SELF_SERVICE'
WHERE EXISTS (SELECT 1 FROM "StudentSurvey" AS s WHERE s."tuteeId" = t.id);
