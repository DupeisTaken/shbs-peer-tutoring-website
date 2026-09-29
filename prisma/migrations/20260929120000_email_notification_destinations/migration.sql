BEGIN;
ALTER TABLE "EmailDelivery" ADD COLUMN destination TEXT;

-- Preserve the original four-argument entry point for existing account triggers.
-- Notification inserts use the five-argument variant so each recipient's row carries
-- its own destination atomically; no timestamp matching or private body copying.
CREATE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT, target TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  IF cat <> 'security' AND NOT EXISTS (
    SELECT 1 FROM "ProgramSettings" WHERE id = 'program' AND "emailNotificationsEnabled"
  ) THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id = uid;
  IF NOT FOUND OR NOT (CASE cat WHEN 'security' THEN true WHEN 'messages' THEN u."emailMessages" WHEN 'info' THEN u."emailInfo" ELSE false END) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id, "userId", category, event, recipient, "previousPrimary", destination)
  SELECT gen_random_uuid()::text, uid, cat, evt, r.email, COALESCE(r.email = old_primary, false), target
  FROM (
    SELECT email FROM "AccountEmail" WHERE "userId" = uid AND "verifiedAt" IS NOT NULL
      AND (email = u.email OR u."emailSecondaryRecipients")
    UNION SELECT old_primary WHERE old_primary IS NOT NULL
  ) r;
END $$;

CREATE OR REPLACE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_account_email(uid, cat, evt, old_primary, NULL);
END $$;

CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_account_email(NEW."userId", CASE WHEN NEW.link = '/messages' THEN 'messages' ELSE 'info' END,
    CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END, NULL, NEW.link);
  RETURN NEW;
END $$;
COMMIT;
