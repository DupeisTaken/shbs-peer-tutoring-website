BEGIN;

-- Admissions keep their exact application ID; other checkpoint adapters name
-- their source explicitly instead of manufacturing an application relationship.
ALTER TABLE "RecoveryAction" ALTER COLUMN "applicationId" DROP NOT NULL;
CREATE TABLE "RecoveryCheckpoint" (
  id TEXT PRIMARY KEY,
  "actionId" TEXT NOT NULL UNIQUE REFERENCES "RecoveryAction"(id) ON DELETE RESTRICT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("schemaVersion" >= 0),
  adapter TEXT NOT NULL,
  "adapterVersion" INTEGER NOT NULL CHECK ("adapterVersion" > 0),
  "sourceEntity" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "capturedById" TEXT NOT NULL,
  "captureTransactionId" TEXT NOT NULL,
  scope JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RecoveryCheckpoint_adapter_sourceId_createdAt_idx" ON "RecoveryCheckpoint"(adapter,"sourceId","createdAt");
CREATE TRIGGER recovery_checkpoint_immutable BEFORE UPDATE OR DELETE ON "RecoveryCheckpoint"
  FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();

-- Feature rows use enum keys instead of an id column. Preserve their exact
-- table identity and safe toggle/revision facts so absent keys and later staging
-- remain covered without broadening any other model's projection.
CREATE OR REPLACE FUNCTION recovery_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE CASE WHEN TG_TABLE_NAME='ProgramFeature' THEN jsonb_build_object('id',to_jsonb(OLD)->'key','key',to_jsonb(OLD)->'key','enabled',to_jsonb(OLD)->'enabled','pendingEnabled',to_jsonb(OLD)->'pendingEnabled','revision',to_jsonb(OLD)->'revision','updatedAt',to_jsonb(OLD)->'updatedAt') WHEN TG_TABLE_NAME='DisciplinaryCard' THEN recovery_safe_row(to_jsonb(OLD)) || jsonb_build_object('source',to_jsonb(OLD)->'source','color',to_jsonb(OLD)->'color','reviewStatus',to_jsonb(OLD)->'reviewStatus') WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(OLD)) ELSE recovery_safe_row(to_jsonb(OLD)) END END;
 a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE CASE WHEN TG_TABLE_NAME='ProgramFeature' THEN jsonb_build_object('id',to_jsonb(NEW)->'key','key',to_jsonb(NEW)->'key','enabled',to_jsonb(NEW)->'enabled','pendingEnabled',to_jsonb(NEW)->'pendingEnabled','revision',to_jsonb(NEW)->'revision','updatedAt',to_jsonb(NEW)->'updatedAt') WHEN TG_TABLE_NAME='DisciplinaryCard' THEN recovery_safe_row(to_jsonb(NEW)) || jsonb_build_object('source',to_jsonb(NEW)->'source','color',to_jsonb(NEW)->'color','reviewStatus',to_jsonb(NEW)->'reviewStatus') WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(NEW)) ELSE recovery_safe_row(to_jsonb(NEW)) END END;
 r JSONB := COALESCE(a,b);
 root_id TEXT;
 event_id TEXT;
 active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
 event_kind TEXT := NULLIF(current_setting('shbs.recovery_kind',true),'');
 record_id TEXT;
 compensating_root TEXT := NULLIF(current_setting('shbs.recovery_compensating',true),'');
 changed_columns JSONB := CASE WHEN TG_OP='UPDATE' THEN
   (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM to_jsonb(OLD)->key)
   WHEN TG_TABLE_NAME='NotificationPreference' THEN
   (SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(CASE WHEN TG_OP='INSERT' THEN to_jsonb(NEW) ELSE to_jsonb(OLD) END))
   ELSE NULL END;
BEGIN
 -- Boolean suppression is no longer a valid protocol: mixed-version callers fail
 -- atomically instead of hiding changes from every overlapping recovery root.
 IF compensating_root='1' THEN
   RAISE EXCEPTION 'Recovery compensation must identify one action' USING ERRCODE='23514';
 END IF;
 -- Mailbox challenges and guess counters are preparation, not a committed
 -- membership event. Consumption/expiry/generation changes remain visible.
 IF TG_TABLE_NAME IN ('RegistrationCode','AccountInvitation') AND TG_OP='UPDATE' AND a=b THEN RETURN NEW; END IF;
 FOR root_id IN
   SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
   WHERE (t.entity='ProgramFeature' AND TG_TABLE_NAME='ProgramFeature' AND t."recordId"=r->>'key')
   OR (t.entity<>'ProgramFeature' AND t."recordId" IN (SELECT value #>> '{}' FROM
     (SELECT value FROM jsonb_each(COALESCE(a,'{}')) UNION ALL SELECT value FROM jsonb_each(COALESCE(b,'{}'))) refs
     WHERE jsonb_typeof(value) = 'string'))
   UNION SELECT t."actionId" FROM "RecoveryTrackedEntity" t
     JOIN recovery_planning_references(TG_TABLE_NAME,COALESCE(to_jsonb(NEW),to_jsonb(OLD))) refs
       ON refs.entity=t.entity AND refs.record_id=t."recordId"
   UNION SELECT active_root WHERE active_root IS NOT NULL
   ORDER BY 1
 LOOP
   -- A compensation suppresses its own evidence only; every other root must
   -- see this transaction, including roots reached through planning references.
   IF root_id=compensating_root THEN CONTINUE; END IF;
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
    (event_id,root_id,txid_current()::text,COALESCE(CASE WHEN compensating_root IS NOT NULL THEN 'RECOVERY_COMPENSATION' END,CASE WHEN root_id=active_root THEN event_kind END,CASE WHEN TG_TABLE_NAME IN ('Pairing','PairingTutee') AND TG_OP='INSERT' THEN 'ASSIGNMENT' WHEN TG_TABLE_NAME='AccountInvitation' THEN 'INVITATION' ELSE 'UNSUPPORTED' END))
    ON CONFLICT ("actionId","transactionId") DO NOTHING;
   INSERT INTO "RecoveryChange"("actionId","eventId","entity","operation","recordKey","before","after","changedFields")
    VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,
      CASE WHEN TG_TABLE_NAME='ProgramFeature' THEN jsonb_build_object('key',r->'key') WHEN TG_TABLE_NAME='NotificationPreference' THEN
        jsonb_build_object('userId',r->'userId','category',CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->'category' ELSE to_jsonb(NEW)->'category' END)
      ELSE COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key='id' OR key LIKE '%Id' OR (TG_TABLE_NAME='SessionPlanningReceipt' AND key='clientKey')),'{}') END,b,a,changed_columns);
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

COMMIT;
