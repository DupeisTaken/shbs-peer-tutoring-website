-- Preference INSERT/DELETE evidence includes every column name, never its values.
-- This preserves fail-closed behavior if the preference schema gains an unknown field.
CREATE OR REPLACE FUNCTION recovery_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE recovery_safe_row(to_jsonb(OLD)) END;
 a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE recovery_safe_row(to_jsonb(NEW)) END;
 r JSONB := COALESCE(a,b);
 root_id TEXT;
 event_id TEXT;
 active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
 event_kind TEXT := NULLIF(current_setting('shbs.recovery_kind',true),'');
 record_id TEXT;
 changed_columns JSONB := CASE WHEN TG_OP='UPDATE' THEN
   (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM to_jsonb(OLD)->key)
   WHEN TG_TABLE_NAME='NotificationPreference' THEN
   (SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(CASE WHEN TG_OP='INSERT' THEN to_jsonb(NEW) ELSE to_jsonb(OLD) END))
   ELSE NULL END;
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
   UNION SELECT active_root WHERE active_root IS NOT NULL
   ORDER BY 1
 LOOP
   -- Serialize every descendant with apply. Serializable apply also retries or
   -- rejects a stale snapshot after a waiting writer commits.
   PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
   IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN
     -- A completed void cannot acquire new descendants through a stale writer.
     IF TG_OP <> 'DELETE' AND
       ((TG_TABLE_NAME IN ('Pairing','Session','QualificationGrant') AND r->>'tutorId' = (SELECT "after"->'tutor'->>'id' FROM "RecoveryAction" WHERE id=root_id))
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
      CASE WHEN TG_TABLE_NAME='NotificationPreference' THEN
        jsonb_build_object('userId',r->'userId','category',CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->'category' ELSE to_jsonb(NEW)->'category' END)
      ELSE COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key='id' OR key LIKE '%Id'),'{}') END,b,a,changed_columns);
   record_id := r->>'id';
   IF record_id IS NOT NULL THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,TG_TABLE_NAME,record_id) ON CONFLICT DO NOTHING;
   END IF;
   -- Pairing membership propagates scope to its student, but never to unrelated
   -- foreign keys such as the administrator, programme term or shared subject.
   IF TG_TABLE_NAME='PairingTutee' THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,'Tutee',r->>'tuteeId') ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;

-- Preferences were introduced after the original recovery journal installation.
-- Keep complete coverage; the adapter preserves reviewed preference writes.
DROP TRIGGER IF EXISTS recovery_change_journal ON "NotificationPreference";
CREATE TRIGGER recovery_change_journal
AFTER INSERT OR UPDATE OR DELETE ON "NotificationPreference"
FOR EACH ROW EXECUTE FUNCTION recovery_capture_change();
