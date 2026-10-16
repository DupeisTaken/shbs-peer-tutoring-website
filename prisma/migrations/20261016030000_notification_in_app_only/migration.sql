ALTER TABLE "Notification" ADD COLUMN "inAppOnly" BOOLEAN NOT NULL DEFAULT false;

-- Keep every existing notification's optional-email behavior. Explicit in-app-only
-- workflow notices must never enter the delivery outbox, even with email enabled.
CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evt TEXT;
  safe_context JSONB;
BEGIN
  IF NEW."inAppOnly" THEN RETURN NEW; END IF;
  -- Preserve the typed event/privacy boundary installed by notification events.
  -- Suppressing a room notice must not downgrade any other workflow's transport.
  evt := COALESCE(NEW.event, CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END);
  IF evt IN ('attendance_cards_pending', 'attendance_history_updated') THEN
    safe_context := jsonb_build_object('count', NEW.context->'count');
  ELSIF evt = 'interview_scheduled' THEN
    safe_context := jsonb_build_object('startsAt', NEW.context->'startsAt', 'timeZone', NEW.context->'timeZone');
  ELSE safe_context := NULL;
  END IF;
  PERFORM queue_account_email(NEW."userId", CASE WHEN evt = 'message_received' THEN 'messages' ELSE 'info' END,
    evt, NULL, NEW.link, safe_context);
  RETURN NEW;
END $$;
