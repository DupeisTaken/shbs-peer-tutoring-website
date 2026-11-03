-- Preserve applied 052000. An exact late provider acceptance may settle an
-- uncertain admitted attempt, while the immutable stop still forbids replay.
CREATE OR REPLACE FUNCTION recovery_delivery_retry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "RecoveryDeliveryEffect" e JOIN "RecoveryDeliveryCancellation" c ON c."effectId"=e.id WHERE e."deliveryId"=OLD.id) THEN
    IF OLD.status IN ('SENDING','UNCERTAIN','UNCERTAIN_RECOVERY') AND NEW.status='SENT'
      AND OLD."attemptId" IS NOT NULL AND OLD."attemptStartedAt" IS NOT NULL
      AND NEW."attemptId"=OLD."attemptId" THEN RETURN NEW; END IF;
    IF NEW.status='SENT' AND OLD.status<>'SENT' THEN
      RAISE EXCEPTION 'Stopped delivery requires exact admitted transport acceptance' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('PENDING','SENDING') THEN
      NEW.status:=CASE WHEN OLD.status='SENT' THEN 'SENT' ELSE 'CANCELLED' END;
      NEW."leaseUntil":=NULL;
      NEW."completedAt":=COALESCE(OLD."completedAt",CURRENT_TIMESTAMP);
    END IF;
  END IF;
  RETURN NEW;
END $$;
