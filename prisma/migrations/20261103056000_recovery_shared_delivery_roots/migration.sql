BEGIN;

-- One physical notice can be a consequence recorded by several prospective
-- roots. Each root keeps its own immutable event/effect evidence and stop ledger.
DROP INDEX "RecoveryDeliveryEffect_deliveryId_key";
CREATE INDEX "RecoveryDeliveryEffect_deliveryId_idx" ON "RecoveryDeliveryEffect"("deliveryId");

-- Version 1 could report zero effects on an older overlapping checkpoint. Do not
-- backfill guessed origins. Only new transactions attest the stronger observer.
CREATE FUNCTION recovery_delivery_event_coverage_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RecoveryDeliveryCoverage"("eventId","actionId",version)
    VALUES(NEW.id,NEW."actionId",CASE WHEN current_setting('shbs.recovery_delivery_unknown',true)='1' THEN 0 ELSE 2 END);
  RETURN NEW;
END $$;
DROP TRIGGER recovery_delivery_event_coverage ON "RecoveryEvent";
CREATE TRIGGER recovery_delivery_event_coverage AFTER INSERT ON "RecoveryEvent"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_event_coverage_v2();

CREATE FUNCTION recovery_delivery_record_v2(effect_kind TEXT,record_id TEXT,notification_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source JSONB; candidates TEXT[]; primary_event TEXT; targets JSONB; target RECORD;
BEGIN
  -- Fresh compensation outcomes belong to the new review, never the original
  -- mistaken action. In particular, an owner draft does not mutate its old survey.
  IF NULLIF(current_setting('shbs.recovery_compensating',true),'') IS NOT NULL THEN RETURN; END IF;
  BEGIN source:=NULLIF(current_setting('shbs.recovery_delivery_source',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN PERFORM recovery_delivery_unknown(); RETURN; END;
  IF source IS NULL OR jsonb_typeof(source)<>'object'
    OR source->>'entity' NOT IN ('TutorApplication','Pairing','PairingCreationRequest','AccountInvitation','User','Tutor','Tutee','StudentSurvey','Session','DisciplinaryCard','ScheduledProgramRefresh','CrewApplication','TutorStatusRequest','CrewStatusRequest','StudentRequestReview','TuteeRemovalRequest','SchoolDepartureEvent')
    OR jsonb_typeof(source->'recordId') IS DISTINCT FROM 'string' OR length(source->>'recordId') NOT BETWEEN 1 AND 200
    OR (source ? 'actionId' AND (jsonb_typeof(source->'actionId') IS DISTINCT FROM 'string' OR length(source->>'actionId') NOT BETWEEN 1 AND 200)) THEN
    PERFORM recovery_delivery_unknown(); RETURN;
  END IF;
  -- Preserve explicit primary selection. Multiple unselected candidates remain
  -- ambiguous; a shared recipient or tracked scalar never chooses an origin.
  SELECT array_agg(id ORDER BY id) INTO candidates FROM (
    SELECT DISTINCT e.id FROM "RecoveryEvent" e JOIN "RecoveryTrackedEntity" t ON t."actionId"=e."actionId"
    WHERE e."transactionId"=txid_current()::text AND t.entity=source->>'entity' AND t."recordId"=source->>'recordId'
      AND (NOT (source ? 'actionId') OR e."actionId"=source->>'actionId')
      AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" r WHERE r."actionId"=e."actionId")
    LIMIT 101
  ) selected_source;
  IF COALESCE(array_length(candidates,1),0)<>1 THEN PERFORM recovery_delivery_unknown(); RETURN; END IF;
  primary_event:=candidates[1];
  -- All accepted sources use an explicitly reviewed id field. A caller must
  -- name the row it actually mutated before notifying, not an unchanged owner.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('actionId',matched."actionId",'eventId',matched."eventId")),'[]') INTO targets FROM (
    SELECT DISTINCT c."actionId",c."eventId"
    FROM "RecoveryChange" c JOIN "RecoveryEvent" e ON e.id=c."eventId" AND e."actionId"=c."actionId"
    WHERE e."transactionId"=txid_current()::text AND c.entity=source->>'entity'
      AND jsonb_typeof(c."recordKey"->'id')='string' AND c."recordKey"->>'id'=source->>'recordId'
      AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" r WHERE r."actionId"=c."actionId")
    ORDER BY c."actionId",c."eventId" LIMIT 101
  ) matched;
  IF jsonb_array_length(targets)>100 OR NOT EXISTS(
    SELECT 1 FROM jsonb_to_recordset(targets) AS proof("actionId" TEXT,"eventId" TEXT) WHERE proof."eventId"=primary_event
  ) THEN PERFORM recovery_delivery_unknown(); RETURN; END IF;
  FOR target IN SELECT * FROM jsonb_to_recordset(targets) AS proof("actionId" TEXT,"eventId" TEXT) ORDER BY "actionId" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('recovery:'||target."actionId",0));
    IF EXISTS(SELECT 1 FROM "RecoveryReceipt" r WHERE r."actionId"=target."actionId") THEN CONTINUE; END IF;
    INSERT INTO "RecoveryDeliveryEffect"(id,"actionId","eventId","notificationId","deliveryId") VALUES(
      md5(target."actionId"||':'||effect_kind||':'||record_id),target."actionId",target."eventId",notification_id,
      CASE WHEN effect_kind='delivery' THEN record_id END);
  END LOOP;
END $$;

CREATE FUNCTION recovery_delivery_start_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.recovery_notification_stack',true),''),'[]')::jsonb;
BEGIN
  PERFORM set_config('shbs.recovery_notification_stack',(stack||jsonb_build_array(NEW.id))::text,true);
  PERFORM recovery_delivery_record_v2('notification',NEW.id,NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER aa_recovery_delivery_start ON "Notification";
CREATE TRIGGER aa_recovery_delivery_start AFTER INSERT ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_start_v2();
CREATE FUNCTION recovery_delivery_mail_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.recovery_notification_stack',true),''),'[]')::jsonb;
BEGIN
  IF NEW.category<>'security' THEN PERFORM recovery_delivery_record_v2('delivery',NEW.id,stack->>-1); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER recovery_delivery_mail ON "EmailDelivery";
CREATE TRIGGER recovery_delivery_mail AFTER INSERT ON "EmailDelivery"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_mail_v2();

COMMIT;
