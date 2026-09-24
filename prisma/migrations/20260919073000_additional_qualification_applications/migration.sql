CREATE TYPE "TutorApplicationType" AS ENUM ('INITIAL', 'ADDITIONAL_SUBJECT', 'HIGHER_LEVEL');
ALTER TABLE "TutorApplication"
  ADD COLUMN "type" "TutorApplicationType" NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN "requestedTutorId" TEXT,
  ADD COLUMN "requestedSubjectId" TEXT,
  ADD COLUMN "qualificationReason" TEXT,
  ADD COLUMN "qualificationDecidedById" TEXT,
  ADD COLUMN "qualificationSnapshot" JSONB;
ALTER TABLE "TutorApplication"
  ADD CONSTRAINT "TutorApplication_requestedTutorId_fkey" FOREIGN KEY ("requestedTutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TutorApplication_requestedSubjectId_fkey" FOREIGN KEY ("requestedSubjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TutorApplication_qualification_request_shape" CHECK (
    ("type" = 'INITIAL' AND "requestedTutorId" IS NULL AND "requestedSubjectId" IS NULL) OR
    ("type" <> 'INITIAL' AND "requestedTutorId" IS NOT NULL AND "requestedSubjectId" IS NOT NULL AND "qualificationReason" IS NOT NULL AND length(trim("qualificationReason")) > 0)
  );
CREATE INDEX "TutorApplication_requestedTutorId_createdAt_idx" ON "TutorApplication"("requestedTutorId", "createdAt");
-- A request remains unique while it is queued or under interview, including concurrent submissions.
CREATE UNIQUE INDEX "TutorApplication_open_qualification_request" ON "TutorApplication"("requestedTutorId", "requestedSubjectId")
  WHERE "type" <> 'INITIAL' AND "status" IN ('PENDING', 'INTERVIEW');

-- Historical qualification decisions must not be reopened/deleted through legacy application tools.
-- Completion/attendance corrections remain possible without rewriting the decision or its grants.
CREATE FUNCTION preserve_qualification_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."type" <> 'INITIAL' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Qualification request history must be retained';
    END IF;
    IF (NEW."type", NEW."requestedTutorId", NEW."requestedSubjectId", NEW."qualificationReason")
      IS DISTINCT FROM (OLD."type", OLD."requestedTutorId", OLD."requestedSubjectId", OLD."qualificationReason") THEN
      RAISE EXCEPTION 'Qualification request identity is immutable';
    END IF;
    IF OLD."status" IN ('ACCEPTED', 'REJECTED') AND
      (NEW."status", NEW."qualificationDecidedById", NEW."qualificationSnapshot", NEW."decidedAt", NEW."decisionComment", NEW."decidedByTutorId")
      IS DISTINCT FROM (OLD."status", OLD."qualificationDecidedById", OLD."qualificationSnapshot", OLD."decidedAt", OLD."decisionComment", OLD."decidedByTutorId") THEN
      RAISE EXCEPTION 'Qualification decisions are final';
    END IF;
    IF NEW."status" IN ('ACCEPTED', 'REJECTED') AND
      (NEW."qualificationDecidedById" IS NULL OR NEW."decidedAt" IS NULL OR NEW."decisionComment" IS NULL OR
       (NEW."status" = 'ACCEPTED' AND NEW."qualificationSnapshot" IS NULL)) THEN
      RAISE EXCEPTION 'Qualification decision evidence is required';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TutorApplication_preserve_qualification_request"
  BEFORE UPDATE OR DELETE ON "TutorApplication"
  FOR EACH ROW EXECUTE FUNCTION preserve_qualification_application();
