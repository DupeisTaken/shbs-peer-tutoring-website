BEGIN;
ALTER TABLE "EmailDelivery" ADD COLUMN "sourceNotificationId" TEXT;
CREATE INDEX "EmailDelivery_sourceNotificationId_idx" ON "EmailDelivery"("sourceNotificationId");

-- A separate transaction-local stack composes with recovery's causal stack.
-- It records exact new origins even when no recovery action is being captured.
CREATE FUNCTION identity_notification_origin_begin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.identity_notification_stack',true),''),'[]')::JSONB;
BEGIN
 PERFORM set_config('shbs.identity_notification_stack',(stack||jsonb_build_array(NEW.id))::TEXT,true);
 RETURN NEW;
END $$;
CREATE FUNCTION identity_notification_origin_end() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.identity_notification_stack',true),''),'[]')::JSONB;
BEGIN
 IF jsonb_array_length(stack)=0 OR stack->>-1 IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Notification origin stack mismatch'; END IF;
 PERFORM set_config('shbs.identity_notification_stack',(stack-(jsonb_array_length(stack)-1))::TEXT,true);
 RETURN NEW;
END $$;
CREATE TRIGGER aaa_identity_notification_origin AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION identity_notification_origin_begin();
CREATE TRIGGER zzz_identity_notification_origin AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION identity_notification_origin_end();
CREATE FUNCTION identity_delivery_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stack JSONB:=COALESCE(NULLIF(current_setting('shbs.identity_notification_stack',true),''),'[]')::JSONB;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."sourceNotificationId" IS DISTINCT FROM OLD."sourceNotificationId" THEN RAISE EXCEPTION 'Original notification provenance is immutable' USING ERRCODE='23514'; END IF;
 ELSIF NEW."sourceNotificationId" IS NULL AND jsonb_array_length(stack)>0 THEN NEW."sourceNotificationId":=stack->>-1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_delivery_origin BEFORE INSERT OR UPDATE ON "EmailDelivery" FOR EACH ROW EXECUTE FUNCTION identity_delivery_origin();

-- Admission takes the same ownership fence before marking transport started.
-- Leased but unadmitted mail can be cancelled; admitted/sent evidence is retained.
CREATE FUNCTION cancel_corrected_notification_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity NOT IN ('Notification','EmailDelivery') THEN RETURN NEW; END IF;
 UPDATE "EmailDelivery" SET status='CANCELLED',"completedAt"=CURRENT_TIMESTAMP,"leaseUntil"=NULL
 WHERE status='PENDING' AND "attemptStartedAt" IS NULL AND category IN ('messages','info','information','review','reminder')
  AND ((NEW.entity='Notification' AND "sourceNotificationId"=NEW."recordId" AND "userId" IS DISTINCT FROM NEW."readerUserId")
    OR (NEW.entity='EmailDelivery' AND id=NEW."recordId" AND NEW."readerUserId" IS NULL));
 RETURN NEW;
END $$;
CREATE TRIGGER cancel_corrected_notification_mail AFTER INSERT OR UPDATE ON "HistoryRowOwnership"
 FOR EACH ROW EXECUTE FUNCTION cancel_corrected_notification_mail();
COMMIT;
