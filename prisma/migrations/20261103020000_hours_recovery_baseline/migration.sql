BEGIN;

-- Validate coverage before registering existing rows. A disabled or incompatible
-- guard is an operator decision to investigate, never a reason to overwrite it.
SELECT recovery_install_hours_journal();

-- Report snapshots are immutable. Register a conservative present-day baseline
-- directly in recovery evidence instead of issuing no-op UPDATEs on report rows.
-- This follows the capture trigger's existing top-level identity matching; it
-- does not infer ownership from names, addresses or private report contents.
CREATE FUNCTION recovery_register_hours_baseline() RETURNS void LANGUAGE plpgsql AS $$
DECLARE table_name TEXT; safe_row JSONB; root_id TEXT; event_id TEXT; key_row JSONB;
 added_identities INTEGER; inserted_identity INTEGER;
BEGIN
 -- A report can introduce the identity referenced by an earlier schedule row.
 -- Follow that finite identity graph to completion in this call, irrespective of
 -- table/insertion order. Shared schedules conservatively connect all editions.
 LOOP
  added_identities := 0;
  FOREACH table_name IN ARRAY ARRAY['MonthlyHoursSchedule','MonthlyHoursReport','SchoolHoursSchedule','SchoolHoursReport'] LOOP
   FOR safe_row IN EXECUTE format('SELECT recovery_safe_row(to_jsonb(r)) FROM public.%I r ORDER BY r.id',table_name) LOOP
     SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO key_row
       FROM jsonb_each(safe_row) WHERE key='id' OR key LIKE '%Id';
     FOR root_id IN SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
       WHERE t."recordId" IN (SELECT value #>> '{}' FROM jsonb_each(safe_row) WHERE jsonb_typeof(value)='string')
       ORDER BY 1 LOOP
       PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
       IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN CONTINUE; END IF;
       event_id := md5(root_id || ':hours-journal-baseline-v1');
       IF EXISTS(SELECT 1 FROM "RecoveryChange" WHERE "eventId"=event_id AND entity=table_name AND "recordKey"=key_row) THEN CONTINUE; END IF;
       INSERT INTO "RecoveryFence"("actionId",revision) VALUES(root_id,1)
         ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
       INSERT INTO "RecoveryEvent"(id,"actionId","transactionId",kind)
         VALUES(event_id,root_id,'hours-journal-baseline-v1','UNSUPPORTED')
         ON CONFLICT ("actionId","transactionId") DO NOTHING;
       INSERT INTO "RecoveryChange"("actionId","eventId",entity,operation,"recordKey","before","after","changedFields")
         VALUES(root_id,event_id,table_name,'BASELINE',key_row,NULL,safe_row,NULL);
       IF safe_row->>'id' IS NOT NULL THEN
         INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,table_name,safe_row->>'id') ON CONFLICT DO NOTHING;
         GET DIAGNOSTICS inserted_identity = ROW_COUNT;
         added_identities := added_identities + inserted_identity;
       END IF;
     END LOOP;
   END LOOP;
  END LOOP;
  EXIT WHEN added_identities=0;
 END LOOP;
END $$;

SELECT recovery_register_hours_baseline();
COMMIT;
