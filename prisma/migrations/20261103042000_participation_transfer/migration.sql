CREATE TABLE "ParticipantConsolidation" (
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TUTOR','TUTEE')),
  "sourceId" TEXT NOT NULL, "targetId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  "receiptId" TEXT NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParticipantConsolidation_pkey" PRIMARY KEY ("kind","sourceId"),
  CHECK ("sourceId"<>"targetId")
);
CREATE INDEX "ParticipantConsolidation_kind_targetId_idx" ON "ParticipantConsolidation"("kind","targetId");
CREATE TABLE "PairingExecutionSuccessor" (
  "sourcePairingId" TEXT NOT NULL PRIMARY KEY, "targetPairingId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  CHECK ("sourcePairingId"<>"targetPairingId")
);
CREATE INDEX "PairingExecutionSuccessor_targetPairingId_idx" ON "PairingExecutionSuccessor"("targetPairingId");
CREATE TABLE "SessionPlanExecution" (
  "planId" TEXT NOT NULL PRIMARY KEY, "tutorId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "receiptId" TEXT NOT NULL,
  "assignments" JSONB NOT NULL CHECK (jsonb_typeof("assignments")='array')
);
CREATE INDEX "SessionPlanExecution_tutorId_idx" ON "SessionPlanExecution"("tutorId");
CREATE TABLE "SessionParticipantExecution" (
  "participantId" TEXT NOT NULL PRIMARY KEY, "tuteeId" TEXT NOT NULL,
  "sourceSurveyIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "receiptId" TEXT NOT NULL
);
CREATE INDEX "SessionParticipantExecution_tuteeId_idx" ON "SessionParticipantExecution"("tuteeId");
CREATE TABLE "SessionResponseExecution" (
  "responseId" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
  "profileKind" TEXT NOT NULL CHECK ("profileKind" IN ('TUTOR','TUTEE')), "profileId" TEXT NOT NULL, "respondedByUserId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "receiptId" TEXT NOT NULL
);
CREATE INDEX "SessionResponseExecution_userId_idx" ON "SessionResponseExecution"("userId");
CREATE TABLE "QualificationTransferGrant" (
  "targetTutorId" TEXT NOT NULL, "sourceTutorId" TEXT NOT NULL,
  "sourceSubjectId" TEXT NOT NULL, "subjectId" TEXT NOT NULL,
  "approvedById" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL, "grantedAt" TIMESTAMP(3) NOT NULL,
  "receiptId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  CONSTRAINT "QualificationTransferGrant_pkey" PRIMARY KEY ("targetTutorId","sourceTutorId","sourceSubjectId","subjectId")
);
CREATE INDEX "QualificationTransferGrant_targetTutorId_subjectId_idx" ON "QualificationTransferGrant"("targetTutorId","subjectId");
CREATE TABLE "PersonParticipationTransferReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
  "personId" TEXT NOT NULL, "retainedUserId" TEXT NOT NULL,
  "selection" JSONB NOT NULL, "result" JSONB NOT NULL, "subjects" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION participation_transfer_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Participation transfer receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER participation_transfer_receipt_immutable BEFORE UPDATE OR DELETE ON "PersonParticipationTransferReceipt"
FOR EACH ROW EXECUTE FUNCTION participation_transfer_receipt_immutable();

-- A correction must advance its authority generation even when returning A -> B -> A.
CREATE FUNCTION participation_execution_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Execution authority requires a versioned replacement' USING ERRCODE='23514';
  END IF;
  IF (TG_TABLE_NAME='ParticipantConsolidation' AND jsonb_build_array(to_jsonb(NEW)->'kind',to_jsonb(NEW)->'sourceId') IS DISTINCT FROM jsonb_build_array(to_jsonb(OLD)->'kind',to_jsonb(OLD)->'sourceId')) THEN
    RAISE EXCEPTION 'Execution authority source keys are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='PairingExecutionSuccessor' AND (to_jsonb(NEW)->'sourcePairingId') IS DISTINCT FROM (to_jsonb(OLD)->'sourcePairingId') OR
     TG_TABLE_NAME='SessionPlanExecution' AND (to_jsonb(NEW)->'planId') IS DISTINCT FROM (to_jsonb(OLD)->'planId') OR
     TG_TABLE_NAME='SessionParticipantExecution' AND (to_jsonb(NEW)->'participantId') IS DISTINCT FROM (to_jsonb(OLD)->'participantId') OR
     TG_TABLE_NAME='SessionResponseExecution' AND (to_jsonb(NEW)->'responseId') IS DISTINCT FROM (to_jsonb(OLD)->'responseId') OR
     TG_TABLE_NAME='QualificationTransferGrant' AND
       (jsonb_build_array(to_jsonb(NEW)->'targetTutorId',to_jsonb(NEW)->'sourceTutorId',to_jsonb(NEW)->'sourceSubjectId',to_jsonb(NEW)->'subjectId')) IS DISTINCT FROM
       (jsonb_build_array(to_jsonb(OLD)->'targetTutorId',to_jsonb(OLD)->'sourceTutorId',to_jsonb(OLD)->'sourceSubjectId',to_jsonb(OLD)->'subjectId')) THEN
    RAISE EXCEPTION 'Execution authority source keys are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='SessionParticipantExecution' AND (to_jsonb(NEW)->'sourceSurveyIds') IS DISTINCT FROM (to_jsonb(OLD)->'sourceSurveyIds') THEN
    RAISE EXCEPTION 'Published request provenance is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."revision"<=OLD."revision" THEN
    RAISE EXCEPTION 'Execution authority revision must advance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['ParticipantConsolidation','PairingExecutionSuccessor','SessionPlanExecution','SessionParticipantExecution','SessionResponseExecution','QualificationTransferGrant'] LOOP
    EXECUTE format('CREATE TRIGGER participation_execution_revision BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION participation_execution_revision()', relation_name);
  END LOOP;
END $$;

-- Retained sources are evidence, never an alternative current mutation path.
CREATE FUNCTION protect_transferred_pairing_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id text;
BEGIN
  IF TG_TABLE_NAME='Pairing' THEN source_id:=OLD.id;
  ELSE source_id:=CASE WHEN TG_OP='INSERT' THEN NEW."pairingId" ELSE OLD."pairingId" END;
  END IF;
  IF EXISTS (SELECT 1 FROM "PairingExecutionSuccessor" WHERE "sourcePairingId"=source_id) THEN
    RAISE EXCEPTION 'Transferred recurring source is immutable; use its execution successor' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='PairingTutee' THEN
    IF TG_OP='UPDATE' THEN
      IF EXISTS (SELECT 1 FROM "PairingExecutionSuccessor" WHERE "sourcePairingId"=NEW."pairingId") THEN
        RAISE EXCEPTION 'Cannot add membership to a transferred recurring source' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_transferred_pairing_source BEFORE UPDATE OR DELETE ON "Pairing"
FOR EACH ROW EXECUTE FUNCTION protect_transferred_pairing_source();
CREATE TRIGGER protect_transferred_pairing_source BEFORE INSERT OR UPDATE OR DELETE ON "PairingTutee"
FOR EACH ROW EXECUTE FUNCTION protect_transferred_pairing_source();

CREATE TABLE "StudentRequestExecutionAssignment" (
  "surveyId" TEXT NOT NULL, "pairingId" TEXT NOT NULL, "tuteeId" TEXT NOT NULL,
  "sourceTuteeId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  "receiptId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "StudentRequestExecutionAssignment_pkey" PRIMARY KEY ("surveyId","pairingId")
);
CREATE INDEX "StudentRequestExecutionAssignment_membership_idx"
ON "StudentRequestExecutionAssignment"("pairingId","tuteeId","releasedAt");
CREATE FUNCTION student_request_execution_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Request execution ownership requires a versioned release' USING ERRCODE='23514';
  END IF;
  IF (NEW."surveyId",NEW."pairingId",NEW."sourceTuteeId") IS DISTINCT FROM (OLD."surveyId",OLD."pairingId",OLD."sourceTuteeId") OR NEW."revision"<=OLD."revision" THEN
    RAISE EXCEPTION 'Request execution source is immutable and revision must advance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_request_execution_revision BEFORE UPDATE OR DELETE ON "StudentRequestExecutionAssignment"
FOR EACH ROW EXECUTE FUNCTION student_request_execution_revision();

-- This table records transfer provenance; eligibility remains the native approved
-- qualification/concrete grant. Revoking native authority retires its materialization.
CREATE FUNCTION retire_transferred_qualification_materialization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='QualificationGrant' THEN
    UPDATE "QualificationTransferGrant" SET active=false, revision=revision+1
    WHERE "targetTutorId"=OLD."tutorId" AND "sourceSubjectId"=OLD."sourceSubjectId"
      AND "subjectId"=OLD."subjectId" AND active;
  ELSIF TG_OP='DELETE' OR NEW.status<>'APPROVED' THEN
    UPDATE "QualificationTransferGrant" SET active=false, revision=revision+1
    WHERE "targetTutorId"=OLD."tutorId" AND "sourceSubjectId"=OLD."subjectId" AND active;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retire_transferred_qualification_materialization AFTER DELETE ON "QualificationGrant"
FOR EACH ROW EXECUTE FUNCTION retire_transferred_qualification_materialization();
CREATE TRIGGER retire_transferred_qualification_materialization AFTER UPDATE OR DELETE ON "TutorQualification"
FOR EACH ROW EXECUTE FUNCTION retire_transferred_qualification_materialization();

-- Request withdrawals share the exact membership tombstone mechanism without
-- masquerading as a continuation assignment or rewriting published actors.
ALTER TABLE "SessionPlanContinuationMember" ALTER COLUMN "assignmentId" DROP NOT NULL;
ALTER TABLE "SessionPlanContinuationMember" ADD COLUMN "sourceSurveyId" TEXT;
ALTER TABLE "SessionPlanContinuationMember" ADD CONSTRAINT "SessionPlanContinuationMember_source_check"
CHECK (("assignmentId" IS NOT NULL) <> ("sourceSurveyId" IS NOT NULL));
CREATE INDEX "SessionPlanContinuationMember_sourceSurveyId_idx" ON "SessionPlanContinuationMember"("sourceSurveyId");


-- A closed original profile can execute another independent OPEN request only
-- through that request's exact, live assignment map. The original closed source
-- never regains queue authority; missing/released maps retain the old rejection.
CREATE OR REPLACE FUNCTION protect_closed_student_roster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id TEXT;
  blocked BOOLEAN;
  admitted BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME='Tutee' THEN
    IF NEW.status='INACTIVE' THEN RETURN NEW; END IF;
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
