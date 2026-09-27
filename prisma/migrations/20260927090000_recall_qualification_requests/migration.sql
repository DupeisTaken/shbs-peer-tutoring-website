-- Keep recall evidence separate from reviewer decisions; history and panel records survive.
ALTER TYPE "TutorApplicationStatus" ADD VALUE 'RECALLED';
ALTER TABLE "TutorApplication" ADD COLUMN "recalledAt" TIMESTAMP(3), ADD COLUMN "recalledById" TEXT;
-- Cast to text so the constraint can be installed in the enum migration transaction.
ALTER TABLE "TutorApplication" ADD CONSTRAINT "TutorApplication_recall_evidence" CHECK (
  ("status"::text = 'RECALLED' AND "type" <> 'INITIAL' AND "recalledAt" IS NOT NULL AND "recalledById" IS NOT NULL) OR
  ("status"::text <> 'RECALLED' AND "recalledAt" IS NULL AND "recalledById" IS NULL)
);

CREATE OR REPLACE FUNCTION preserve_qualification_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."type" <> 'INITIAL' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Qualification request history must be retained';
    END IF;
    IF (NEW."type", NEW."requestedTutorId", NEW."requestedSubjectId", NEW."qualificationReason")
      IS DISTINCT FROM (OLD."type", OLD."requestedTutorId", OLD."requestedSubjectId", OLD."qualificationReason") THEN
      RAISE EXCEPTION 'Qualification request identity is immutable';
    END IF;
    IF OLD."status"::text IN ('ACCEPTED', 'REJECTED', 'RECALLED') AND
      (NEW."status", NEW."qualificationDecidedById", NEW."qualificationSnapshot", NEW."decidedAt", NEW."decisionComment", NEW."decidedByTutorId", NEW."recalledAt", NEW."recalledById")
      IS DISTINCT FROM (OLD."status", OLD."qualificationDecidedById", OLD."qualificationSnapshot", OLD."decidedAt", OLD."decisionComment", OLD."decidedByTutorId", OLD."recalledAt", OLD."recalledById") THEN
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
