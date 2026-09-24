-- Keep every password-writing path (recovery, settings, invitations and bootstrap) atomic
-- with session revocation. Existing JWTs have no version and deliberately require sign-in.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION advance_account_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" THEN
    NEW."sessionVersion" := OLD."sessionVersion" + 1;
  ELSE
    -- Application profile updates must not restore an earlier credential generation.
    NEW."sessionVersion" := OLD."sessionVersion";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_session_version BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION advance_account_session_version();
