BEGIN;

-- Explicit typed references, never actor/reviewer IDs or arbitrary payload text.
CREATE FUNCTION identity_authority_subjects(table_name TEXT, row_data JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE refs JSONB := '[]'; item JSONB; field_name TEXT; target_entity TEXT;
BEGIN
 IF row_data IS NULL THEN RETURN refs; END IF;
 IF table_name IN ('PersonHistoryCorrectionReceipt','PersonParticipationTransferReceipt') THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('entity',s.entity,'recordId',s."recordId")),'[]') INTO refs
   FROM jsonb_to_recordset(row_data->'subjects') AS s(entity TEXT,"recordId" TEXT)
   WHERE s.entity IN ('Person','User','Tutor','Tutee','Pairing','SessionPlan','SessionPlanParticipant','SessionPlanningResponse','Notification','StudentQuarterBlock','EmailDelivery','TutorQualification','QualificationGrant') AND s."recordId" IS NOT NULL;
  RETURN refs;
 END IF;
 FOR field_name,target_entity IN
  SELECT field,target FROM (VALUES
   ('RetiredHistoryOwnership','sourceUserId','User'),('RetiredHistoryOwnership','readerUserId','User'),
   ('HistoryRowOwnership','readerUserId','User'),
   ('PairingExecutionSuccessor','sourcePairingId','Pairing'),('PairingExecutionSuccessor','targetPairingId','Pairing'),
   ('SessionPlanExecution','planId','SessionPlan'),('SessionPlanExecution','tutorId','Tutor'),
   ('SessionParticipantExecution','participantId','SessionPlanParticipant'),('SessionParticipantExecution','tuteeId','Tutee'),
   ('SessionResponseExecution','responseId','SessionPlanningResponse'),('SessionResponseExecution','userId','User'),
   ('QualificationTransferGrant','sourceTutorId','Tutor'),('QualificationTransferGrant','targetTutorId','Tutor'),
   ('StudentRequestExecutionAssignment','surveyId','StudentSurvey'),('StudentRequestExecutionAssignment','pairingId','Pairing'),('StudentRequestExecutionAssignment','tuteeId','Tutee'),('StudentRequestExecutionAssignment','sourceTuteeId','Tutee')
  ) AS fields(tbl,field,target) WHERE tbl=table_name
 LOOP
  IF row_data->>field_name IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity',target_entity,'recordId',row_data->>field_name)); END IF;
 END LOOP;
 IF table_name='ParticipantConsolidation' THEN
  target_entity:=CASE row_data->>'kind' WHEN 'TUTOR' THEN 'Tutor' WHEN 'TUTEE' THEN 'Tutee' END;
  IF target_entity IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity',target_entity,'recordId',row_data->>'sourceId'),jsonb_build_object('entity',target_entity,'recordId',row_data->>'targetId')); END IF;
 ELSIF table_name='HistoryRowOwnership' THEN
  IF row_data->>'entity' IN ('Tutor','Tutee','Notification','StudentQuarterBlock','EmailDelivery') THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity',row_data->>'entity','recordId',row_data->>'recordId')); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(row_data->'quarantineUserIds','[]')||COALESCE(row_data->'sourceUserIds','[]')) LOOP
   IF jsonb_typeof(item)='string' THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity','User','recordId',item#>>'{}')); END IF;
  END LOOP;
 ELSIF table_name='SessionResponseExecution' THEN
  target_entity:=CASE row_data->>'profileKind' WHEN 'TUTOR' THEN 'Tutor' WHEN 'TUTEE' THEN 'Tutee' END;
  IF target_entity IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity',target_entity,'recordId',row_data->>'profileId')); END IF;
 ELSIF table_name='SessionParticipantExecution' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(row_data->'sourceSurveyIds','[]')) LOOP
   IF jsonb_typeof(item)='string' THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity','StudentSurvey','recordId',item#>>'{}')); END IF;
  END LOOP;
 ELSIF table_name='SessionPlanExecution' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(row_data->'assignments','[]')) LOOP
   IF item->>'sourcePairingId' IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity','Pairing','recordId',item->>'sourcePairingId')); END IF;
   IF item->>'targetPairingId' IS NOT NULL THEN refs:=refs||jsonb_build_array(jsonb_build_object('entity','Pairing','recordId',item->>'targetPairingId')); END IF;
  END LOOP;
 END IF;
 RETURN refs;
END $$;

CREATE FUNCTION identity_authority_projection(table_name TEXT, row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN row_data IS NULL THEN NULL ELSE COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(row_data)
 WHERE key IN ('id','sourceUserId','readerUserId','quarantineUserIds','sourceUserIds','sourceSurveyIds','entity','recordId','revision','state','kind','sourceId','targetId','sourcePairingId','targetPairingId','planId','tutorId','participantId','tuteeId','responseId','userId','profileKind','profileId','sourceTutorId','targetTutorId','sourceSubjectId','subjectId','surveyId','pairingId','sourceTuteeId','releasedAt','active','personId','destinationPersonId','retainedUserId','effectiveAt','createdAt','updatedAt')),'{}')
 || CASE WHEN table_name IN ('PersonHistoryCorrectionReceipt','PersonParticipationTransferReceipt') THEN jsonb_build_object('subjects',identity_authority_subjects(table_name,row_data)) ELSE '{}' END END;
$$;

CREATE FUNCTION recovery_capture_identity_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b JSONB:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 a JSONB:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 r JSONB:=COALESCE(a,b); refs JSONB; primary_fields TEXT[]; record_key JSONB; record_id TEXT;
 root_id TEXT; event_id TEXT; changed JSONB;
 compensating_root TEXT:=NULLIF(current_setting('shbs.recovery_compensating',true),'');
BEGIN
 IF compensating_root='1' THEN RAISE EXCEPTION 'Recovery compensation requires an exact root'; END IF;
 refs:=identity_authority_subjects(TG_TABLE_NAME,b)||identity_authority_subjects(TG_TABLE_NAME,a);
 primary_fields:=CASE TG_TABLE_NAME
  WHEN 'RetiredHistoryOwnership' THEN ARRAY['sourceUserId']
  WHEN 'HistoryRowOwnership' THEN ARRAY['entity','recordId']
  WHEN 'ParticipantConsolidation' THEN ARRAY['kind','sourceId']
  WHEN 'PairingExecutionSuccessor' THEN ARRAY['sourcePairingId']
  WHEN 'SessionPlanExecution' THEN ARRAY['planId']
  WHEN 'SessionParticipantExecution' THEN ARRAY['participantId']
  WHEN 'SessionResponseExecution' THEN ARRAY['responseId']
  WHEN 'QualificationTransferGrant' THEN ARRAY['targetTutorId','sourceTutorId','sourceSubjectId','subjectId']
  WHEN 'StudentRequestExecutionAssignment' THEN ARRAY['surveyId','pairingId']
  WHEN 'PersonHistoryCorrectionReceipt' THEN ARRAY['id']
  WHEN 'PersonParticipationTransferReceipt' THEN ARRAY['id']
 END;
 IF primary_fields IS NULL THEN RAISE EXCEPTION 'Unregistered identity authority table'; END IF;
 SELECT jsonb_object_agg(key,value) INTO record_key FROM jsonb_each(r) WHERE key=ANY(primary_fields);
 record_id:=CASE WHEN cardinality(primary_fields)=1 THEN r->>primary_fields[1] ELSE record_key::TEXT END;
 refs:=refs||jsonb_build_array(jsonb_build_object('entity',TG_TABLE_NAME,'recordId',record_id));
 SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]') INTO changed
 FROM (SELECT key FROM jsonb_object_keys(COALESCE(a,'{}')||COALESCE(b,'{}')) AS fields(key)
       WHERE a->key IS DISTINCT FROM b->key) fields;
 FOR root_id IN
  SELECT DISTINCT tracked."actionId" FROM "RecoveryTrackedEntity" tracked
  JOIN jsonb_to_recordset(refs) AS subject(entity TEXT,"recordId" TEXT)
   ON tracked.entity=subject.entity AND tracked."recordId"=subject."recordId"
  ORDER BY tracked."actionId"
 LOOP
  IF root_id=compensating_root THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recovery:'||root_id,0));
  IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN CONTINUE; END IF;
  INSERT INTO "RecoveryFence"("actionId",revision) VALUES(root_id,1) ON CONFLICT("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
  event_id:=md5(root_id||':'||txid_current()::TEXT);
  INSERT INTO "RecoveryEvent"(id,"actionId","transactionId",kind) VALUES(event_id,root_id,txid_current()::TEXT,CASE WHEN compensating_root IS NULL THEN 'UNSUPPORTED' ELSE 'RECOVERY_COMPENSATION' END)
   ON CONFLICT("actionId","transactionId") DO NOTHING;
  INSERT INTO "RecoveryChange"("actionId","eventId",entity,operation,"recordKey",before,after,"changedFields")
   VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,record_key,identity_authority_projection(TG_TABLE_NAME,b),identity_authority_projection(TG_TABLE_NAME,a),changed);
  INSERT INTO "RecoveryTrackedEntity"("actionId",entity,"recordId") VALUES(root_id,TG_TABLE_NAME,record_id) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;
DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY['RetiredHistoryOwnership','HistoryRowOwnership','PersonHistoryCorrectionReceipt','ParticipantConsolidation','PairingExecutionSuccessor','SessionPlanExecution','SessionParticipantExecution','SessionResponseExecution','QualificationTransferGrant','PersonParticipationTransferReceipt','StudentRequestExecutionAssignment'] LOOP
  EXECUTE format('CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION recovery_capture_identity_authority()',table_name);
 END LOOP;
END $$;
-- Exact request membership tombstones retain their original survey edge.
CREATE OR REPLACE FUNCTION recovery_capture_continuation_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  raw_before JSONB := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  raw_after JSONB := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  raw_row JSONB := COALESCE(raw_after,raw_before);
  b JSONB; a JSONB; root_id TEXT; event_id TEXT; key_row JSONB;
  active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
BEGIN
  IF current_setting('shbs.recovery_compensating',true)='1' THEN RAISE EXCEPTION 'Recovery compensation requires an exact root'; END IF;
  SELECT jsonb_object_agg(key,value) INTO b FROM jsonb_each(raw_before)
    WHERE key IN ('id','userId','surveyId','sourceSurveyId','sourcePairingId','sourceTuteeId','targetTermId','targetPairingId','pairingId','planId','tuteeId','tutorId','assignmentId','status','reason','createdAt','assignedAt','joinedAt','releasedAt');
  SELECT jsonb_object_agg(key,value) INTO a FROM jsonb_each(raw_after)
    WHERE key IN ('id','userId','surveyId','sourceSurveyId','sourcePairingId','sourceTuteeId','targetTermId','targetPairingId','pairingId','planId','tuteeId','tutorId','assignmentId','status','reason','createdAt','assignedAt','joinedAt','releasedAt');
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
        ('User',r.data->>'userId'), ('StudentSurvey',r.data->>'surveyId'), ('StudentSurvey',r.data->>'sourceSurveyId'),
        ('Pairing',r.data->>'pairingId'), ('Pairing',r.data->>'sourcePairingId'),
        ('Pairing',r.data->>'targetPairingId'), ('Tutee',r.data->>'tuteeId'),
        ('Tutee',r.data->>'sourceTuteeId'), ('Tutor',r.data->>'tutorId'),
        ('SessionPlan',r.data->>'planId'),
        ('StudentContinuationAssignment',r.data->>'assignmentId')
      ) ref(entity,id)
      UNION SELECT 'Tutee',s."tuteeId" FROM "StudentSurvey" s JOIN rows r ON s.id IN (r.data->>'surveyId',r.data->>'sourceSurveyId')
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
    IF root_id=NULLIF(current_setting('shbs.recovery_compensating',true),'') THEN CONTINUE; END IF;
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

COMMIT;
