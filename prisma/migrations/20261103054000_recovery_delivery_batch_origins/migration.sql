BEGIN;

-- BEFORE row triggers for a bulk INSERT all run before queued AFTER events.
-- Bracket each row's nested mail enqueue with ordered AFTER triggers instead:
-- aa_recovery_delivery_start, notification_email_notice, zz_recovery_delivery_end.
-- Keep 052000 unchanged so already-applied installations upgrade additively.
DROP TRIGGER IF EXISTS recovery_delivery_start ON public."Notification";
DROP TRIGGER IF EXISTS aa_recovery_delivery_start ON public."Notification";
CREATE TRIGGER aa_recovery_delivery_start AFTER INSERT ON public."Notification"
  FOR EACH ROW EXECUTE FUNCTION recovery_delivery_start();

COMMIT;
