ALTER TABLE "Notification" ADD COLUMN "inAppOnly" BOOLEAN NOT NULL DEFAULT false;

-- Keep every existing notification's optional-email behavior. Explicit in-app-only
-- workflow notices must never enter the delivery outbox, even with email enabled.
CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."inAppOnly" THEN RETURN NEW; END IF;
  PERFORM queue_account_email(NEW."userId", CASE WHEN NEW.link = '/messages' THEN 'messages' ELSE 'info' END,
    CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END, NULL, NEW.link);
  RETURN NEW;
END $$;
