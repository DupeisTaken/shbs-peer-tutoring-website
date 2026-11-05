-- Prospective evidence only. Missing/deleted historical rows never imply a decline.
CREATE TABLE "LegacySignupDecline" (
  "tuteeId" TEXT NOT NULL PRIMARY KEY,
  "termId" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedById" TEXT NOT NULL,
  "resolvedByName" TEXT,
  "expectedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "clientKey" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inputHash" TEXT NOT NULL DEFAULT '',
  "intakeSnapshot" JSONB NOT NULL,
  CONSTRAINT "LegacySignupDecline_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LegacySignupDecline_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LegacySignupDecline_termId_resolvedAt_idx" ON "LegacySignupDecline"("termId", "resolvedAt");

-- An older checkpoint tracking this Tutee must observe the terminal decision,
-- even when decline has no active recovery root of its own.
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "LegacySignupDecline"
FOR EACH ROW EXECUTE FUNCTION recovery_capture_change();

-- Preserve the existing independent-request execution exception. A retained
-- decline is an exact-source terminal fence and never acquires that exception.
CREATE OR REPLACE FUNCTION protect_closed_student_roster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id TEXT;
  blocked BOOLEAN;
  admitted BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME='Tutee' THEN
    -- Ownership/history and canonical profile metadata may still be corrected.
    IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status='INACTIVE' THEN RETURN NEW; END IF;
    target_id:=NEW.id;
  ELSE
    target_id:=NEW."tuteeId";
  END IF;
  IF EXISTS (SELECT 1 FROM "LegacySignupDecline" WHERE "tuteeId"=target_id) THEN
    RAISE EXCEPTION 'Declined signup cannot be assigned or reactivated';
  END IF;
  SELECT EXISTS (SELECT 1 FROM "StudentSurvey" source WHERE source."tuteeId"=target_id AND
    (source.state<>'OPEN' OR source."invalidatedAt" IS NOT NULL OR
      (source."confirmedAt" IS NULL AND source."verificationDueAt"<=CURRENT_TIMESTAMP))) INTO blocked;
  IF NOT blocked THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='PairingTutee' THEN
    SELECT EXISTS (
      SELECT 1 FROM "StudentRequestExecutionAssignment" execution
      JOIN "StudentSurvey" source ON source.id=execution."surveyId" AND source."tuteeId"=execution."sourceTuteeId"
      JOIN "Pairing" pairing ON pairing.id=execution."pairingId" AND pairing."termId"=source."intakeTermId"
      JOIN "Term" term ON term.id=pairing."termId" AND term.active
      WHERE execution."pairingId"=NEW."pairingId" AND execution."tuteeId"=NEW."tuteeId"
        AND execution."releasedAt" IS NULL AND source.state='OPEN' AND source."invalidatedAt" IS NULL
        AND (source."confirmedAt" IS NOT NULL OR source."verificationDueAt" IS NULL OR source."verificationDueAt">CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM "PairingExecutionSuccessor" successor WHERE successor."sourcePairingId"=pairing.id)
    ) INTO admitted;
  ELSIF NEW.status='ACTIVE' THEN
    SELECT EXISTS (
      SELECT 1 FROM "StudentRequestExecutionAssignment" execution
      JOIN "StudentSurvey" source ON source.id=execution."surveyId" AND source."tuteeId"=execution."sourceTuteeId"
      JOIN "Pairing" pairing ON pairing.id=execution."pairingId" AND pairing."termId"=source."intakeTermId"
      JOIN "Term" term ON term.id=pairing."termId" AND term.active
      JOIN "PairingTutee" membership ON membership."pairingId"=execution."pairingId" AND membership."tuteeId"=execution."tuteeId"
      WHERE execution."tuteeId"=target_id AND execution."releasedAt" IS NULL
        AND source.state='OPEN' AND source."invalidatedAt" IS NULL
        AND (source."confirmedAt" IS NOT NULL OR source."verificationDueAt" IS NULL OR source."verificationDueAt">CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM "PairingExecutionSuccessor" successor WHERE successor."sourcePairingId"=pairing.id)
    ) INTO admitted;
  END IF;
  IF NOT admitted THEN RAISE EXCEPTION 'Closed or expired student request cannot be assigned or reactivated'; END IF;
  RETURN NEW;
END $$;
