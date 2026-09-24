-- Keep schema changes and the ownership backfill atomic if a legacy address collision is found.
BEGIN;
ALTER TYPE "VerificationPurpose" ADD VALUE 'SECONDARY_EMAIL';
ALTER TABLE "User" ADD COLUMN "emailSecurity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailMessages" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailInfo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailSecondaryRecipients" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgramSettings" ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PasswordResetToken" ADD COLUMN "targetEmail" TEXT;
UPDATE "PasswordResetToken" r SET "targetEmail" = lower(trim(u.email)) FROM "User" u WHERE u.id = r."userId";

CREATE TABLE "AccountEmail" (
  email TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "verifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountEmail_normalized" CHECK (email = lower(trim(email)))
);
CREATE INDEX "AccountEmail_userId_idx" ON "AccountEmail"("userId");
-- Fail safely if legacy addresses collide after normalization; never merge identities.
INSERT INTO "AccountEmail" (email, "userId", "verifiedAt") SELECT lower(trim(email)), id, "emailVerifiedAt" FROM "User";
UPDATE "User" SET email = lower(trim(email));

CREATE TABLE "EmailDelivery" (
  id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  category TEXT NOT NULL, event TEXT NOT NULL, recipient TEXT NOT NULL,
  "previousPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3), "completedAt" TIMESTAMP(3), status TEXT NOT NULL DEFAULT 'PENDING', "lastError" TEXT
);
CREATE INDEX "EmailDelivery_status_availableAt_idx" ON "EmailDelivery"(status, "availableAt");

-- Reserve primary addresses for every existing writer (signup, invitations, admin edits).
CREATE FUNCTION normalize_account_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.email := lower(trim(NEW.email)); RETURN NEW; END $$;
CREATE TRIGGER account_email_normalize BEFORE INSERT OR UPDATE OF email ON "User"
FOR EACH ROW EXECUTE FUNCTION normalize_account_email();
CREATE FUNCTION reserve_account_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "AccountEmail" (email, "userId", "verifiedAt") VALUES (NEW.email, NEW.id, NEW."emailVerifiedAt")
  ON CONFLICT (email) DO UPDATE SET "verifiedAt" = EXCLUDED."verifiedAt"
    WHERE "AccountEmail"."userId" = NEW.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email address is already associated with another account' USING ERRCODE = '23505'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.email <> NEW.email THEN
    -- Keep a verified former primary as a secondary, but never retain an unproved identifier.
    DELETE FROM "AccountEmail" WHERE email = OLD.email AND "userId" = NEW.id AND "verifiedAt" IS NULL;
    -- Outstanding login/step-up challenges belong to the previous primary destination.
    UPDATE "EmailVerificationCode" SET "consumedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = NEW.id AND "consumedAt" IS NULL AND purpose IN ('LOGIN_2FA', 'PASSWORD_CHANGE', 'EMAIL_CHANGE');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_email_reserve AFTER INSERT OR UPDATE OF email, "emailVerifiedAt" ON "User"
FOR EACH ROW EXECUTE FUNCTION reserve_account_email();

-- Revocation follows the address itself, including an unverified former primary removed by
-- the compatibility trigger. Re-adding an address must never revive an old recovery grant.
CREATE FUNCTION revoke_removed_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "PasswordResetToken" SET "consumedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = OLD."userId" AND "targetEmail" = OLD.email AND "consumedAt" IS NULL;
  UPDATE "EmailVerificationCode" SET "consumedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = OLD."userId" AND "targetEmail" = OLD.email AND "consumedAt" IS NULL;
  RETURN OLD;
END $$;
CREATE TRIGGER account_email_revoke AFTER DELETE ON "AccountEmail"
FOR EACH ROW EXECUTE FUNCTION revoke_removed_email();

-- Queue in the same transaction as the event. Both enqueue and dispatch honor current preferences.
CREATE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ProgramSettings" WHERE id = 'program' AND "emailNotificationsEnabled") THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id = uid;
  IF NOT FOUND OR NOT (CASE cat WHEN 'security' THEN u."emailSecurity" WHEN 'messages' THEN u."emailMessages" WHEN 'info' THEN u."emailInfo" ELSE false END) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id, "userId", category, event, recipient, "previousPrimary")
  SELECT gen_random_uuid()::text, uid, cat, evt, r.email, COALESCE(r.email = old_primary, false)
  FROM (
    SELECT email FROM "AccountEmail" WHERE "userId" = uid AND "verifiedAt" IS NOT NULL
      AND (email = u.email OR u."emailSecondaryRecipients")
    UNION SELECT old_primary WHERE old_primary IS NOT NULL
  ) r;
END $$;

-- Database event detection covers staff edits, password reset, and every account settings surface.
-- No secret values or message contents enter the outbox; unchanged writes enqueue nothing.
CREATE FUNCTION account_update_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" THEN
    -- Password rotation revokes verification grants authorized by the old credential.
    UPDATE "EmailVerificationCode" SET "consumedAt" = CURRENT_TIMESTAMP WHERE "userId" = NEW.id AND "consumedAt" IS NULL;
    UPDATE "PasswordResetToken" SET "consumedAt" = CURRENT_TIMESTAMP WHERE "userId" = NEW.id AND "consumedAt" IS NULL;
  END IF;
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    PERFORM queue_account_email(NEW.id, 'security', 'primary_changed', CASE WHEN OLD."emailVerifiedAt" IS NOT NULL THEN OLD.email ELSE NULL END);
  ELSIF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" OR OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled" THEN
    PERFORM queue_account_email(NEW.id, 'security', 'security_changed');
  END IF;
  IF OLD.name IS DISTINCT FROM NEW.name OR OLD."alternativeNames" IS DISTINCT FROM NEW."alternativeNames"
     OR OLD.role IS DISTINCT FROM NEW.role OR OLD."suspendedAt" IS DISTINCT FROM NEW."suspendedAt" THEN
    PERFORM queue_account_email(NEW.id, 'info', 'information_changed');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_update_notice AFTER UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION account_update_email();

CREATE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_account_email(NEW."userId", CASE WHEN NEW.link = '/messages' THEN 'messages' ELSE 'info' END,
    CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END);
  RETURN NEW;
END $$;
CREATE TRIGGER notification_email_notice AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_email();
COMMIT;
