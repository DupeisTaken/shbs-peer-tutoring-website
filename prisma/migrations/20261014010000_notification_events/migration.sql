BEGIN;
ALTER TABLE "Notification" ADD COLUMN event TEXT, ADD COLUMN context JSONB;
ALTER TABLE "EmailDelivery" ADD COLUMN context JSONB;

-- The event transaction owns identity, destination and safe context together. The
-- trigger deliberately never copies arbitrary notification titles or body text.
CREATE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT, target TEXT, safe_context JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  IF cat <> 'security' AND NOT EXISTS (
    SELECT 1 FROM "ProgramSettings" WHERE id = 'program' AND "emailNotificationsEnabled"
  ) THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id = uid;
  IF NOT FOUND OR NOT (CASE cat WHEN 'security' THEN true WHEN 'messages' THEN u."emailMessages" WHEN 'info' THEN u."emailInfo" ELSE false END) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id, "userId", category, event, recipient, "previousPrimary", destination, context)
  SELECT gen_random_uuid()::text, uid, cat, evt, r.email, COALESCE(r.email = old_primary, false), target, safe_context
  FROM (
    SELECT email FROM "AccountEmail" WHERE "userId" = uid AND "verifiedAt" IS NOT NULL
      AND (email = u.email OR u."emailSecondaryRecipients")
    UNION SELECT old_primary WHERE old_primary IS NOT NULL
  ) r;
END $$;

CREATE OR REPLACE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT, target TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_account_email(uid, cat, evt, old_primary, target, NULL);
END $$;

CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evt TEXT;
  safe_context JSONB;
BEGIN
  evt := COALESCE(NEW.event, CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END);
  -- Defend the persistence boundary too: no new payload field becomes email copy
  -- merely because a future caller stores it in Notification.context.
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
COMMIT;
