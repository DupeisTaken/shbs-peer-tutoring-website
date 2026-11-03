ALTER TABLE "Notification" ADD COLUMN "recoveryWithdrawnAt" TIMESTAMP(3);
CREATE TABLE "RecoveryDeliveryEffect" (
  id TEXT PRIMARY KEY,"actionId" TEXT NOT NULL,"eventId" TEXT NOT NULL,
  "notificationId" TEXT,"deliveryId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RecoveryDeliveryEffect_deliveryId_key" ON "RecoveryDeliveryEffect"("deliveryId");
CREATE INDEX "RecoveryDeliveryEffect_actionId_eventId_idx" ON "RecoveryDeliveryEffect"("actionId","eventId");
CREATE INDEX "RecoveryDeliveryEffect_notificationId_idx" ON "RecoveryDeliveryEffect"("notificationId");
CREATE TABLE "RecoveryDeliveryCancellation" (
  "effectId" TEXT PRIMARY KEY,"recoveryKey" TEXT NOT NULL,disposition TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RecoveryDeliveryCancellation_recoveryKey_idx" ON "RecoveryDeliveryCancellation"("recoveryKey");
CREATE TABLE "RecoveryDeliveryCoverage" (
  "eventId" TEXT PRIMARY KEY,"actionId" TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RecoveryDeliveryCoverage_actionId_idx" ON "RecoveryDeliveryCoverage"("actionId");

-- Do not backfill historical origins from recipients, actors or wall-clock times.
-- Every prospective event attests observation, including transactions with zero
-- effects. An unbound/ambiguous ordinary effect makes that transaction unknown.
CREATE FUNCTION recovery_delivery_event_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RecoveryDeliveryCoverage"("eventId","actionId",version)
    VALUES(NEW.id,NEW."actionId",CASE WHEN current_setting('shbs.recovery_delivery_unknown',true)='1' THEN 0 ELSE 1 END);
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_delivery_event_coverage AFTER INSERT ON "RecoveryEvent"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_event_coverage();
CREATE FUNCTION recovery_delivery_coverage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."actionId" IS DISTINCT FROM OLD."actionId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version<>0 OR NOT EXISTS(SELECT 1 FROM "RecoveryEvent" e WHERE e.id=OLD."eventId" AND e."transactionId"=txid_current()::text) THEN
    RAISE EXCEPTION 'Recovery delivery coverage is finalized' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_delivery_coverage_guard BEFORE UPDATE OR DELETE ON "RecoveryDeliveryCoverage"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_coverage_guard();
CREATE TRIGGER recovery_delivery_effect_immutable BEFORE UPDATE OR DELETE ON "RecoveryDeliveryEffect"
  FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();
CREATE TRIGGER recovery_delivery_cancellation_immutable BEFORE UPDATE OR DELETE ON "RecoveryDeliveryCancellation"
  FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();

CREATE FUNCTION recovery_delivery_unknown() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('shbs.recovery_delivery_unknown','1',true);
  UPDATE "RecoveryDeliveryCoverage" c SET version=0 FROM "RecoveryEvent" e
    WHERE e.id=c."eventId" AND e."transactionId"=txid_current()::text;
END $$;

CREATE FUNCTION recovery_delivery_record(effect_kind TEXT,record_id TEXT,notification_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source JSONB; candidates TEXT[]; source_action TEXT; source_event TEXT;
BEGIN
  -- Recovery outcomes create fresh evidence; they are not new effects of the
  -- original mistaken action. Security notices are excluded by the mail trigger.
  IF NULLIF(current_setting('shbs.recovery_compensating',true),'') IS NOT NULL THEN RETURN; END IF;
  BEGIN source:=NULLIF(current_setting('shbs.recovery_delivery_source',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN PERFORM recovery_delivery_unknown(); RETURN; END;
  IF source IS NULL OR jsonb_typeof(source)<>'object'
    OR source->>'entity' NOT IN ('TutorApplication','Pairing','PairingCreationRequest','AccountInvitation','User','Tutor','Tutee','StudentSurvey','Session','DisciplinaryCard','ScheduledProgramRefresh','CrewApplication','TutorStatusRequest','CrewStatusRequest','StudentRequestReview','TuteeRemovalRequest')
    OR jsonb_typeof(source->'recordId') IS DISTINCT FROM 'string' OR length(source->>'recordId') NOT BETWEEN 1 AND 200
    OR (source ? 'actionId' AND (jsonb_typeof(source->'actionId') IS DISTINCT FROM 'string' OR length(source->>'actionId') NOT BETWEEN 1 AND 200)) THEN
    PERFORM recovery_delivery_unknown(); RETURN;
  END IF;
  SELECT array_agg(id ORDER BY id) INTO candidates FROM (
    SELECT DISTINCT e.id FROM "RecoveryEvent" e JOIN "RecoveryTrackedEntity" t ON t."actionId"=e."actionId"
    WHERE e."transactionId"=txid_current()::text AND t.entity=source->>'entity' AND t."recordId"=source->>'recordId'
      AND (NOT (source ? 'actionId') OR e."actionId"=source->>'actionId')
      AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" r WHERE r."actionId"=e."actionId")
  ) exact_source;
  IF COALESCE(array_length(candidates,1),0)<>1 THEN PERFORM recovery_delivery_unknown(); RETURN; END IF;
  source_event:=candidates[1];
  SELECT "actionId" INTO source_action FROM "RecoveryEvent" WHERE id=source_event;
  INSERT INTO "RecoveryDeliveryEffect"(id,"actionId","eventId","notificationId","deliveryId") VALUES(
    md5(source_action || ':' || effect_kind || ':' || record_id),source_action,source_event,notification_id,
    CASE WHEN effect_kind='delivery' THEN record_id END);
END $$;

-- A stack binds only nested enqueue calls to their exact Notification insert.
-- No address, destination or same-user inference participates in this relation.
CREATE FUNCTION recovery_delivery_start() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.recovery_notification_stack',true),''),'[]')::jsonb;
BEGIN
  PERFORM set_config('shbs.recovery_notification_stack',(stack || jsonb_build_array(NEW.id))::text,true);
  PERFORM recovery_delivery_record('notification',NEW.id,NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_delivery_start BEFORE INSERT ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_start();
CREATE FUNCTION recovery_delivery_end() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.recovery_notification_stack',true),''),'[]')::jsonb;
BEGIN
  IF jsonb_array_length(stack)<1 OR stack->>-1 IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Recovery notification origin stack mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('shbs.recovery_notification_stack',(stack - (jsonb_array_length(stack)-1))::text,true);
  RETURN NEW;
END $$;
CREATE TRIGGER zz_recovery_delivery_end AFTER INSERT ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_end();
CREATE FUNCTION recovery_delivery_mail() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.recovery_notification_stack',true),''),'[]')::jsonb;
BEGIN
  -- Old authentication/security mail remains independent even inside a domain
  -- transaction. Only ordinary explicitly-bound domain notices can be withdrawn.
  IF NEW.category<>'security' THEN
    PERFORM recovery_delivery_record('delivery',NEW.id,stack->>-1);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_delivery_mail AFTER INSERT ON "EmailDelivery"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_mail();

-- A durable stop marker wins over administrative requeue and stale failures.
-- An admitted exact SMTP attempt may still truthfully finish SENT after recovery.
CREATE FUNCTION recovery_delivery_retry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "RecoveryDeliveryEffect" e JOIN "RecoveryDeliveryCancellation" c ON c."effectId"=e.id WHERE e."deliveryId"=OLD.id) THEN
    IF OLD.status='SENDING' AND NEW.status='SENT' AND OLD."attemptId" IS NOT NULL AND NEW."attemptId"=OLD."attemptId" THEN RETURN NEW; END IF;
    IF NEW.status IN ('PENDING','SENDING') THEN
      NEW.status:=CASE WHEN OLD.status='SENT' THEN 'SENT' ELSE 'CANCELLED' END;
      NEW."leaseUntil":=NULL;
      NEW."completedAt":=COALESCE(OLD."completedAt",CURRENT_TIMESTAMP);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_delivery_retry_guard BEFORE UPDATE ON "EmailDelivery"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_retry_guard();
