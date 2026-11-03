-- Preserve applied participation-transfer migration checksums. Metadata-only
-- updates do not admit roster participation; exact assignment checks remain.
CREATE OR REPLACE FUNCTION protect_closed_student_roster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id TEXT;
  blocked BOOLEAN;
  admitted BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME='Tutee' THEN
    -- Ownership/history revisions and other metadata updates do not activate
    -- participation. Guard actual status transitions, not an unchanged status.
    IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status='INACTIVE' THEN RETURN NEW; END IF;
    target_id:=NEW.id;
  ELSE
    target_id:=NEW."tuteeId";
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
