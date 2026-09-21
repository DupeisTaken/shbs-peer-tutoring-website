-- Membership is separate from identity links and never manufactures policy acceptance.
ALTER TABLE "User" ADD COLUMN "tuteeMember" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tutorAccessRevoked" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "tuteeMember" = true
WHERE role <> 'VIEWER' AND ("studentId" IS NOT NULL OR EXISTS (
  SELECT 1 FROM "PolicyAcceptance" p WHERE p."userId" = "User".id AND p.slug = 'tutee-policy'
));

-- Resolve legacy mixed Viewers conservatively: preserve historical identity links, remove
-- read-only management access, and retain their explicitly assigned participation instead.
UPDATE "User" SET role = CASE WHEN "tutorId" IS NOT NULL THEN 'TUTOR'::"Role"
  WHEN "crewStatus" IS NOT NULL THEN 'CREW'::"Role" ELSE 'STUDENT'::"Role" END
WHERE role = 'VIEWER' AND ("tutorId" IS NOT NULL OR "studentId" IS NOT NULL
  OR "canTranslate" OR "crewStatus" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_viewer_exclusive" CHECK (
  role <> 'VIEWER' OR (("tutorId" IS NULL OR "tutorAccessRevoked")
    AND NOT "tuteeMember" AND NOT "canTranslate" AND "crewStatus" IS NULL)
);

-- Old outstanding invitations have no durable Head approval evidence. Preserve their rows,
-- but require Head to issue a fresh grant rather than redeeming pre-change authority.
UPDATE "RegistrationCode" SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP)
WHERE "usedAt" IS NULL;
