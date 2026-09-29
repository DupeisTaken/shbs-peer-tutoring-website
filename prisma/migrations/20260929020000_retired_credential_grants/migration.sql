-- A request admitted before retirement must not create a new login/recovery/step-up grant
-- afterward. The row lock serializes every issuance path with the combine transaction.
CREATE FUNCTION reject_retired_credential_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE retired TEXT;
BEGIN
  SELECT "mergedIntoId" INTO retired FROM "User" WHERE id = NEW."userId" FOR UPDATE;
  IF retired IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot issue credentials for a retired login' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retired_verification_guard BEFORE INSERT ON "EmailVerificationCode"
FOR EACH ROW EXECUTE FUNCTION reject_retired_credential_grant();
CREATE TRIGGER retired_recovery_guard BEFORE INSERT ON "PasswordResetToken"
FOR EACH ROW EXECUTE FUNCTION reject_retired_credential_grant();
