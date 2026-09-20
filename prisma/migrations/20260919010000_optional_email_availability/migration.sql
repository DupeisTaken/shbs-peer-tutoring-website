BEGIN;
-- Keep the existing binding workflow available after upgrade; never remove account data.
ALTER TABLE "ProgramSettings" ADD COLUMN "secondaryEmailBindingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Security events are essential. The legacy emailSecurity value is retained for data
-- compatibility, but neither it nor the optional-notification switch suppresses alerts.
CREATE OR REPLACE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  IF cat <> 'security' AND NOT EXISTS (
    SELECT 1 FROM "ProgramSettings" WHERE id = 'program' AND "emailNotificationsEnabled"
  ) THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id = uid;
  IF NOT FOUND OR NOT (CASE cat WHEN 'security' THEN true WHEN 'messages' THEN u."emailMessages" WHEN 'info' THEN u."emailInfo" ELSE false END) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id, "userId", category, event, recipient, "previousPrimary")
  SELECT gen_random_uuid()::text, uid, cat, evt, r.email, COALESCE(r.email = old_primary, false)
  FROM (
    SELECT email FROM "AccountEmail" WHERE "userId" = uid AND "verifiedAt" IS NOT NULL
      AND (email = u.email OR u."emailSecondaryRecipients")
    UNION SELECT old_primary WHERE old_primary IS NOT NULL
  ) r;
END $$;
COMMIT;
