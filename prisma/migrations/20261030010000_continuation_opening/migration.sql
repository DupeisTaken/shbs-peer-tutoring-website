-- Existing terms have unknown opening history. Never grant a deployment-time hour.
ALTER TABLE "Term"
  ADD COLUMN "signupOpeningStateSince" TIMESTAMP(3),
  ADD COLUMN "signupFirstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "continuationSourceTermId" TEXT,
  ADD COLUMN "continuationQuarterTransition" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Term" ADD CONSTRAINT "continuation_opening_tracking"
  CHECK ("signupFirstOpenedAt" IS NULL OR "signupOpeningStateSince" IS NOT NULL),
  ADD CONSTRAINT "continuation_source_provenance"
  CHECK (("continuationQuarterTransition" AND "continuationSourceTermId" IS NOT NULL AND "signupOpeningStateSince" IS NOT NULL)
    OR (NOT "continuationQuarterTransition" AND "continuationSourceTermId" IS NULL));

CREATE FUNCTION protect_continuation_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."signupFirstOpenedAt" IS NOT NULL AND NEW."signupFirstOpenedAt" IS DISTINCT FROM OLD."signupFirstOpenedAt" THEN
    RAISE EXCEPTION 'First signup opening cannot be reset' USING ERRCODE = '23514';
  END IF;
  IF NEW."continuationSourceTermId" IS DISTINCT FROM OLD."continuationSourceTermId"
    OR NEW."continuationQuarterTransition" IS DISTINCT FROM OLD."continuationQuarterTransition"
    OR (OLD."signupOpeningStateSince" IS NULL AND NEW."signupOpeningStateSince" IS NOT NULL)
    OR (OLD."signupOpeningStateSince" IS NOT NULL AND NEW."signupOpeningStateSince" IS NULL) THEN
    RAISE EXCEPTION 'Signup transition provenance cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER continuation_opening_immutable BEFORE UPDATE ON "Term"
  FOR EACH ROW EXECUTE FUNCTION protect_continuation_opening();

-- Term already has a recovery journal trigger. Extend its safe scalar projection;
-- these timestamps are evidence, never a compensating action that restarts intake.
CREATE OR REPLACE FUNCTION recovery_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) || CASE WHEN row_data->'source'->>'type'='staff' THEN jsonb_build_object('registrationCodeId',row_data->'source'->>'id') ELSE '{}'::jsonb END FROM jsonb_each(row_data)
 WHERE key = 'id' OR key LIKE '%Id' OR key IN ('status','state','role','tutorAccessRevoked','tuteeMember','crewStatus','canTranslate','sessionVersion','profileVersion','historyIdentityRevision','updatedAt','usedAt','expiresAt','firstAssignedAt','verificationDueAt','confirmedAt','recoveryVoidedAt','preferredAssignedBlocks','workloadPreferenceVersion','roomVersion','roomShortageKey','roomMode','roomNeedsAssignment','scheduleConfirmed','dayOfWeek','startMin','endMin','subject','signupOpeningStateSince','signupFirstOpenedAt','continuationQuarterTransition');
$$;
