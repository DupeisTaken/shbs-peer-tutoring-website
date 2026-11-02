-- Scheduling is deliberately unsupported by admission compensation. Journal its
-- identities and safe scheduling facts, never delivery bodies, addresses or capabilities.
CREATE FUNCTION recovery_planning_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(row_data)
 WHERE key IN ('id','planId','pairingId','cohortId','tuteeId','tutorId','termId','requestId','offerId','responseId','actorId','actorUserId','recipientUserId','parentRequestId','currentOfferId','userId','clientKey','status','state','kind','scope','stage','version','sourceVersion','sequence','date','originalDate','startMin','endMin','startsAt','endsAt','roomId','online','rescheduled','sourceInvalidated','scheduleOverride','calendarSuppressed','cutoffAt','deliveredAt','deadline','respondedAt','acceptedAt','completedAt','createdAt','updatedAt','usedAt','revokedAt');
$$;

-- Follow domain parents plus exact live/retained ownership. Emails and Person
-- membership are never ownership evidence. This also reaches a tutor's tutee alias.
CREATE FUNCTION recovery_planning_references(table_name TEXT,row_data JSONB)
RETURNS TABLE(entity TEXT,record_id TEXT) LANGUAGE sql STABLE AS $$
 WITH parent AS (
   SELECT COALESCE(CASE WHEN table_name='SessionPlan' THEN row_data->>'id' END,
     row_data->>'planId',
     (SELECT c."planId" FROM "SessionPlanCohort" c WHERE c.id=row_data->>'cohortId'),
     (SELECT q."planId" FROM "SessionPlanningRequest" q WHERE q.id=COALESCE(row_data->>'requestId',
       (SELECT o."requestId" FROM "SessionPlanningOffer" o WHERE o.id=COALESCE(row_data->>'offerId',
         (SELECT r."offerId" FROM "SessionPlanningResponse" r WHERE r.id=row_data->>'responseId')))))) AS id
   WHERE table_name IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken')
 ), direct AS (
   SELECT 'SessionPlan'::text AS entity,p.id AS record_id FROM parent p
   UNION SELECT 'Tutor',p."tutorId" FROM "SessionPlan" p JOIN parent x ON x.id=p.id
   UNION SELECT 'Tutee',row_data->>'tuteeId' FROM parent
   UNION SELECT 'Tutee',p."tuteeId" FROM "SessionPlanParticipant" p JOIN parent x ON x.id=p."planId"
   UNION SELECT 'Tutee',value FROM parent,jsonb_array_elements_text(CASE WHEN jsonb_typeof(row_data->'tuteeIds')='array' THEN row_data->'tuteeIds' ELSE '[]'::jsonb END)
   UNION SELECT 'User',row_data->>key FROM parent,unnest(ARRAY['actorId','actorUserId','recipientUserId','userId']) key
 ), owned AS (
   SELECT 'User'::text AS entity,u.id AS record_id FROM "User" u JOIN direct d
     ON (d.entity='Tutor' AND d.record_id=u."tutorId") OR (d.entity='Tutee' AND d.record_id=u."studentId")
   UNION SELECT 'User',o."userId" FROM "StudentProfileOwnership" o JOIN direct d ON d.entity='Tutee' AND d.record_id=o."tuteeId"
   UNION SELECT 'User',o."userId" FROM "TutorProfileOwnership" o JOIN direct d ON d.entity='Tutor' AND d.record_id=o."tutorId"
 )
 SELECT DISTINCT entity,record_id FROM (SELECT * FROM direct UNION ALL SELECT * FROM owned) refs WHERE record_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION recovery_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE CASE WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(OLD)) ELSE recovery_safe_row(to_jsonb(OLD)) END END;
 a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE CASE WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(NEW)) ELSE recovery_safe_row(to_jsonb(NEW)) END END;
 r JSONB := COALESCE(a,b);
 root_id TEXT;
 event_id TEXT;
 active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
 event_kind TEXT := NULLIF(current_setting('shbs.recovery_kind',true),'');
 record_id TEXT;
 changed_columns JSONB := CASE WHEN TG_OP='UPDATE' THEN
   (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM to_jsonb(OLD)->key) ELSE NULL END;
BEGIN
 IF current_setting('shbs.recovery_compensating',true) = '1' THEN RETURN COALESCE(NEW,OLD); END IF;
 -- Mailbox challenges and guess counters are preparation, not a committed
 -- membership event. Consumption/expiry/generation changes remain visible.
 IF TG_TABLE_NAME IN ('RegistrationCode','AccountInvitation') AND TG_OP='UPDATE' AND a=b THEN RETURN NEW; END IF;
 FOR root_id IN
   SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
   WHERE t."recordId" IN (SELECT value #>> '{}' FROM
     (SELECT value FROM jsonb_each(COALESCE(a,'{}')) UNION ALL SELECT value FROM jsonb_each(COALESCE(b,'{}'))) refs
     WHERE jsonb_typeof(value) = 'string')
   UNION SELECT t."actionId" FROM "RecoveryTrackedEntity" t
     JOIN recovery_planning_references(TG_TABLE_NAME,COALESCE(to_jsonb(NEW),to_jsonb(OLD))) refs
       ON refs.entity=t.entity AND refs.record_id=t."recordId"
   UNION SELECT active_root WHERE active_root IS NOT NULL
   ORDER BY 1
 LOOP
   -- Serialize every descendant with apply. Serializable apply also retries or
   -- rejects a stale snapshot after a waiting writer commits.
   PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
   IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN
     -- A completed void cannot acquire new descendants through a stale writer.
     IF TG_OP <> 'DELETE' AND
       ((TG_TABLE_NAME IN ('Pairing','Session','QualificationGrant','SessionPlan') AND r->>'tutorId' = (SELECT "after"->'tutor'->>'id' FROM "RecoveryAction" WHERE id=root_id))
         OR (TG_TABLE_NAME='PairingTutee' AND EXISTS(SELECT 1 FROM "Pairing" p JOIN "RecoveryAction" ra ON ra.id=root_id WHERE p.id=r->>'pairingId' AND p."tutorId"=ra."after"->'tutor'->>'id')))
       AND NOT EXISTS(SELECT 1 FROM "TutorApplication" admitted JOIN "RecoveryAction" ra ON ra.id=root_id
         WHERE admitted.type='INITIAL' AND admitted.status='ACCEPTED' AND admitted."promotedTutorId"=ra."after"->'tutor'->>'id'
           AND (admitted.id<>ra."applicationId" OR EXISTS(SELECT 1 FROM "RecoveryAction" fresh
             WHERE fresh.id<>root_id AND fresh."applicationId"=admitted.id AND fresh."after"->'tutor'->>'id'=admitted."promotedTutorId"
               AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" voided WHERE voided."actionId"=fresh.id))))
       AND (SELECT "before"->'tutor'->>'status' IS DISTINCT FROM 'ACTIVE' FROM "RecoveryAction" WHERE id=root_id) THEN
       RAISE EXCEPTION 'Admission was voided; reload assignment state' USING ERRCODE='40001';
     END IF;
     CONTINUE;
   END IF;
   INSERT INTO "RecoveryFence"("actionId","revision") VALUES(root_id,1)
     ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
   event_id := md5(root_id || ':' || txid_current()::text);
   INSERT INTO "RecoveryEvent"("id","actionId","transactionId","kind") VALUES
    (event_id,root_id,txid_current()::text,COALESCE(CASE WHEN root_id=active_root THEN event_kind END,CASE WHEN TG_TABLE_NAME IN ('Pairing','PairingTutee') AND TG_OP='INSERT' THEN 'ASSIGNMENT' WHEN TG_TABLE_NAME='AccountInvitation' THEN 'INVITATION' ELSE 'UNSUPPORTED' END))
    ON CONFLICT ("actionId","transactionId") DO NOTHING;
   INSERT INTO "RecoveryChange"("actionId","eventId","entity","operation","recordKey","before","after","changedFields")
    VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,
      COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key='id' OR key LIKE '%Id' OR (TG_TABLE_NAME='SessionPlanningReceipt' AND key='clientKey')),'{}'),b,a,changed_columns);
   record_id := r->>'id';
   IF record_id IS NOT NULL THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,TG_TABLE_NAME,record_id) ON CONFLICT DO NOTHING;
   END IF;
   -- A participant/account alias can introduce a root after its plan was created.
   -- Retain the parent identity so subsequent cohort/offer changes remain causal.
   INSERT INTO "RecoveryTrackedEntity"("actionId",entity,"recordId")
     SELECT root_id,refs.entity,refs.record_id FROM recovery_planning_references(TG_TABLE_NAME,COALESCE(to_jsonb(NEW),to_jsonb(OLD))) refs
     WHERE refs.entity='SessionPlan' ON CONFLICT DO NOTHING;
   -- Pairing membership propagates scope to its student, but never to unrelated
   -- foreign keys such as the administrator, programme term or shared subject.
   IF TG_TABLE_NAME='PairingTutee' THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,'Tutee',r->>'tuteeId') ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;


-- Existing scheduling rows predate these triggers. Baseline only related roots;
-- absent/unrelated tables are not evidence against every admission. No attempt
-- is made to manufacture historical event order or compensate scheduling facts.
CREATE FUNCTION recovery_register_planning_baseline() RETURNS void LANGUAGE plpgsql AS $$
DECLARE table_name TEXT; raw_row JSONB; safe_row JSONB; root_id TEXT; event_id TEXT; key_row JSONB;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken'] LOOP
   FOR raw_row IN EXECUTE format('SELECT to_jsonb(r) FROM %I r',table_name) LOOP
     safe_row := recovery_planning_safe_row(raw_row);
     SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO key_row
       FROM jsonb_each(safe_row) WHERE key='id' OR key LIKE '%Id' OR key='clientKey';
     FOR root_id IN SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
       JOIN recovery_planning_references(table_name,raw_row) refs ON refs.entity=t.entity AND refs.record_id=t."recordId" ORDER BY 1 LOOP
       PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
       IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN CONTINUE; END IF;
       event_id := md5(root_id || ':session-planning-journal-baseline-v1');
       IF EXISTS(SELECT 1 FROM "RecoveryChange" WHERE "eventId"=event_id AND entity=table_name AND "recordKey"=key_row) THEN CONTINUE; END IF;
       INSERT INTO "RecoveryFence"("actionId",revision) VALUES(root_id,1) ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
       INSERT INTO "RecoveryEvent"(id,"actionId","transactionId",kind) VALUES(event_id,root_id,'session-planning-journal-baseline-v1','UNSUPPORTED') ON CONFLICT ("actionId","transactionId") DO NOTHING;
       INSERT INTO "RecoveryChange"("actionId","eventId",entity,operation,"recordKey","before","after","changedFields")
         VALUES(root_id,event_id,table_name,'BASELINE',key_row,NULL,safe_row,NULL);
       IF safe_row->>'id' IS NOT NULL THEN
         INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,table_name,safe_row->>'id') ON CONFLICT DO NOTHING;
       END IF;
       INSERT INTO "RecoveryTrackedEntity"("actionId",entity,"recordId")
         SELECT root_id,refs.entity,refs.record_id FROM recovery_planning_references(table_name,raw_row) refs WHERE refs.entity='SessionPlan' ON CONFLICT DO NOTHING;
     END LOOP;
   END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION recovery_install_planning_journal() RETURNS void LANGUAGE plpgsql AS $$
DECLARE table_name TEXT; existing RECORD;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken'] LOOP
   SELECT * INTO existing FROM pg_trigger WHERE tgrelid=format('public.%I',table_name)::regclass AND tgname='recovery_change_journal';
   IF FOUND THEN
     -- Older operator/fixture coverage may already have installed this exact
     -- trigger. Reuse valid coverage, but never silently repair an unknown guard.
     IF existing.tgfoid<>'recovery_capture_change()'::regprocedure OR existing.tgtype<>29
       OR existing.tgenabled NOT IN ('O','A') OR existing.tgisinternal
       OR existing.tgnargs<>0 OR existing.tgqual IS NOT NULL
       OR cardinality(existing.tgattr::smallint[])<>0 OR existing.tgconstraint<>0 THEN
       RAISE EXCEPTION 'Recovery journal trigger on % is incompatible; inspect coverage before retrying this migration',table_name USING ERRCODE='23514';
     END IF;
   ELSE
     EXECUTE format('CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION recovery_capture_change()',table_name);
   END IF;
 END LOOP;
END $$;
SELECT recovery_install_planning_journal();
SELECT recovery_register_planning_baseline();

