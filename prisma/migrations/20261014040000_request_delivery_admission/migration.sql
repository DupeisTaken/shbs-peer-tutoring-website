ALTER TABLE "EmailDelivery" ADD COLUMN "attemptId" TEXT, ADD COLUMN "attemptStartedAt" TIMESTAMP(3);

-- A review may resolve once, but must never rewrite the submitted participant evidence.
CREATE FUNCTION preserve_request_appeal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."noticeId" IS DISTINCT FROM NEW."noticeId" OR OLD.body IS DISTINCT FROM NEW.body OR
     OLD."submittedAt" IS DISTINCT FROM NEW."submittedAt" THEN
    RAISE EXCEPTION 'Request appeal submission evidence is immutable';
  END IF;
  IF OLD.status <> 'PENDING' AND (OLD.status IS DISTINCT FROM NEW.status OR
    OLD."reviewVersion" IS DISTINCT FROM NEW."reviewVersion" OR OLD."resolvedAt" IS DISTINCT FROM NEW."resolvedAt" OR
    OLD."reviewedById" IS DISTINCT FROM NEW."reviewedById" OR OLD."decisionReason" IS DISTINCT FROM NEW."decisionReason") THEN
    RAISE EXCEPTION 'Resolved request appeal evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER request_appeal_evidence BEFORE UPDATE ON "RequestInvalidityAppeal"
  FOR EACH ROW EXECUTE FUNCTION preserve_request_appeal_evidence();
