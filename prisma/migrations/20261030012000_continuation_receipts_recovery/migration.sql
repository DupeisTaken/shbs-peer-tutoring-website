CREATE TABLE "StudentContinuationReceipt" (
  "userId" TEXT NOT NULL,
  "clientKey" UUID NOT NULL,
  "inputHash" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentContinuationReceipt_pkey" PRIMARY KEY ("userId", "clientKey")
);
CREATE INDEX "StudentContinuationReceipt_surveyId_idx" ON "StudentContinuationReceipt"("surveyId");

-- Continuation evidence is operational, not a compensatable admission side effect.
-- Follow exact request/participant/tutor parents while excluding payloads, signatures,
-- result snapshots and retry capabilities from the recovery journal.
CREATE FUNCTION recovery_capture_continuation_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  raw_before JSONB := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  raw_after JSONB := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  raw_row JSONB := COALESCE(raw_after,raw_before);
  b JSONB; a JSONB; root_id TEXT; event_id TEXT; key_row JSONB;
  active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
BEGIN
  IF current_setting('shbs.recovery_compensating',true)='1' THEN RETURN COALESCE(NEW,OLD); END IF;
  SELECT jsonb_object_agg(key,value) INTO b FROM jsonb_each(raw_before)
    WHERE key IN ('id','userId','surveyId','sourcePairingId','sourceTuteeId','targetTermId','targetPairingId','pairingId','planId','tuteeId','tutorId','assignmentId','status','reason','createdAt','assignedAt','joinedAt','releasedAt');
  SELECT jsonb_object_agg(key,value) INTO a FROM jsonb_each(raw_after)
    WHERE key IN ('id','userId','surveyId','sourcePairingId','sourceTuteeId','targetTermId','targetPairingId','pairingId','planId','tuteeId','tutorId','assignmentId','status','reason','createdAt','assignedAt','joinedAt','releasedAt');
  key_row := CASE TG_TABLE_NAME
    WHEN 'StudentContinuationReceipt' THEN jsonb_build_object('userId',raw_row->>'userId','receiptFingerprint',md5((raw_row->>'userId') || ':' || (raw_row->>'clientKey')))
    WHEN 'StudentContinuationPairing' THEN jsonb_build_object('sourcePairingId',raw_row->>'sourcePairingId','targetTermId',raw_row->>'targetTermId')
    WHEN 'SessionPlanContinuationMember' THEN jsonb_build_object('planId',raw_row->>'planId','pairingId',raw_row->>'pairingId','tuteeId',raw_row->>'tuteeId')
    ELSE jsonb_build_object('id',raw_row->>'id') END;
  FOR root_id IN
    WITH rows AS (
      SELECT raw_before AS data WHERE raw_before IS NOT NULL
      UNION ALL SELECT raw_after WHERE raw_after IS NOT NULL
    ), direct AS (
      SELECT ref.entity, ref.id FROM rows r CROSS JOIN LATERAL (VALUES
        (TG_TABLE_NAME::text,r.data->>'id'),
        ('User',r.data->>'userId'), ('StudentSurvey',r.data->>'surveyId'),
        ('Pairing',r.data->>'pairingId'), ('Pairing',r.data->>'sourcePairingId'),
        ('Pairing',r.data->>'targetPairingId'), ('Tutee',r.data->>'tuteeId'),
        ('Tutee',r.data->>'sourceTuteeId'), ('Tutor',r.data->>'tutorId'),
        ('SessionPlan',r.data->>'planId'),
        ('StudentContinuationAssignment',r.data->>'assignmentId')
      ) ref(entity,id)
      UNION SELECT 'Tutee',s."tuteeId" FROM "StudentSurvey" s JOIN rows r ON s.id=r.data->>'surveyId'
      UNION SELECT 'Tutor',p."tutorId" FROM "Pairing" p JOIN rows r ON p.id IN (r.data->>'pairingId',r.data->>'targetPairingId',r.data->>'sourcePairingId')
      UNION SELECT 'Tutor',p."tutorId" FROM "SessionPlan" p JOIN rows r ON p.id=r.data->>'planId'
    ), refs AS (
      SELECT entity,id FROM direct
      UNION SELECT 'User',u.id FROM "User" u JOIN direct d
        ON (d.entity='Tutor' AND d.id=u."tutorId") OR (d.entity='Tutee' AND d.id=u."studentId")
      UNION SELECT 'User',o."userId" FROM "StudentProfileOwnership" o JOIN direct d ON d.entity='Tutee' AND d.id=o."tuteeId"
      UNION SELECT 'User',o."userId" FROM "TutorProfileOwnership" o JOIN direct d ON d.entity='Tutor' AND d.id=o."tutorId"
    )
    SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t JOIN refs ON refs.id=t."recordId" AND refs.entity=t.entity
    UNION SELECT active_root WHERE active_root IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
    IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN CONTINUE; END IF;
    INSERT INTO "RecoveryFence"("actionId",revision) VALUES(root_id,1)
      ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
    event_id := md5(root_id || ':' || txid_current()::text);
    INSERT INTO "RecoveryEvent"(id,"actionId","transactionId",kind)
      VALUES(event_id,root_id,txid_current()::text,'UNSUPPORTED') ON CONFLICT ("actionId","transactionId") DO NOTHING;
    INSERT INTO "RecoveryChange"("actionId","eventId",entity,operation,"recordKey","before","after","changedFields")
      VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,key_row,b,a,
        CASE WHEN TG_OP='UPDATE' THEN (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(a) WHERE value IS DISTINCT FROM b->key) ELSE NULL END);
    IF raw_row->>'id' IS NOT NULL THEN
      INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,TG_TABLE_NAME,raw_row->>'id') ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "StudentContinuationReceipt" FOR EACH ROW EXECUTE FUNCTION recovery_capture_continuation_change();
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "StudentContinuationAssignment" FOR EACH ROW EXECUTE FUNCTION recovery_capture_continuation_change();
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "StudentContinuationPairing" FOR EACH ROW EXECUTE FUNCTION recovery_capture_continuation_change();
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "SessionPlanContinuationMember" FOR EACH ROW EXECUTE FUNCTION recovery_capture_continuation_change();
