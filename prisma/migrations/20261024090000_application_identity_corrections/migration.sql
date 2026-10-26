-- Preserve submitted names exactly, including null versus deliberately empty parts.
ALTER TABLE "TutorApplication" ADD COLUMN "identityRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ApplicationIdentityOriginal" (
  "applicationId" TEXT NOT NULL,
  "original" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationIdentityOriginal_pkey" PRIMARY KEY ("applicationId")
);

CREATE TABLE "ApplicationIdentityCorrection" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "policy" JSONB NOT NULL,
  "approvalId" TEXT,
  "receiptOwner" TEXT NOT NULL,
  "clientKey" UUID NOT NULL,
  "inputHash" TEXT NOT NULL,
  "appliedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationIdentityCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationIdentityCorrection_applicationId_fkey" FOREIGN KEY ("applicationId")
    REFERENCES "ApplicationIdentityOriginal"("applicationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "ApplicationIdentityCorrection_applicationId_revision_key"
  ON "ApplicationIdentityCorrection"("applicationId", "revision");
CREATE UNIQUE INDEX "ApplicationIdentityCorrection_receiptOwner_clientKey_key"
  ON "ApplicationIdentityCorrection"("receiptOwner", "clientKey");
CREATE INDEX "ApplicationIdentityCorrection_applicationId_createdAt_idx"
  ON "ApplicationIdentityCorrection"("applicationId", "createdAt");

INSERT INTO "ApplicationIdentityOriginal" ("applicationId", "original", "submittedAt")
SELECT id, jsonb_build_object('name', name, 'firstName', "firstName", 'lastName', "lastName",
  'preferredName', "preferredName", 'alternativeNames', "alternativeNames"), "createdAt"
FROM "TutorApplication";

CREATE FUNCTION capture_application_identity_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ApplicationIdentityOriginal" ("applicationId", "original", "submittedAt")
  VALUES (NEW.id, jsonb_build_object('name', NEW.name, 'firstName', NEW."firstName",
    'lastName', NEW."lastName", 'preferredName', NEW."preferredName",
    'alternativeNames', NEW."alternativeNames"), NEW."createdAt");
  RETURN NEW;
END;
$$;
CREATE TRIGGER application_identity_original_insert AFTER INSERT ON "TutorApplication"
  FOR EACH ROW EXECUTE FUNCTION capture_application_identity_original();

-- Neither an operational delete nor another writer can rewrite the audit trail.
CREATE FUNCTION immutable_application_identity_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Application identity evidence is immutable';
END;
$$;
CREATE TRIGGER application_identity_original_immutable BEFORE UPDATE OR DELETE ON "ApplicationIdentityOriginal"
  FOR EACH ROW EXECUTE FUNCTION immutable_application_identity_evidence();
CREATE TRIGGER application_identity_correction_immutable BEFORE UPDATE OR DELETE ON "ApplicationIdentityCorrection"
  FOR EACH ROW EXECUTE FUNCTION immutable_application_identity_evidence();
