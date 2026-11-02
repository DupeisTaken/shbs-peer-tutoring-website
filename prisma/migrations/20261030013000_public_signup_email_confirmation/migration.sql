-- Mailbox proof and account/access redemption are separate boundaries. Remember
-- the first ordinary public proof so resends and recalls cannot revive continuation.
ALTER TABLE "StudentSurvey" ADD COLUMN "publicSignupEmailConfirmedAt" TIMESTAMP(3);

-- Retain the confirmation boundary in causal recovery without exporting proofs.
CREATE OR REPLACE FUNCTION recovery_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) || CASE WHEN row_data->'source'->>'type'='staff' THEN jsonb_build_object('registrationCodeId',row_data->'source'->>'id') ELSE '{}'::jsonb END FROM jsonb_each(row_data)
 WHERE key = 'id' OR key LIKE '%Id' OR key IN ('status','state','role','tutorAccessRevoked','tuteeMember','crewStatus','canTranslate','sessionVersion','profileVersion','historyIdentityRevision','updatedAt','usedAt','expiresAt','firstAssignedAt','verificationDueAt','confirmedAt','publicSignupEmailConfirmedAt','recoveryVoidedAt','preferredAssignedBlocks','workloadPreferenceVersion','roomVersion','roomShortageKey','roomMode','roomNeedsAssignment','scheduleConfirmed','dayOfWeek','startMin','endMin','subject','signupOpeningStateSince','signupFirstOpenedAt','continuationQuarterTransition');
$$;

WITH evidence AS (
  -- A continuation may adopt an unconfirmed ordinary survey; its immutable
  -- receipt, rather than original answers, proves that confirmation's origin.
  SELECT s.id, s."confirmedAt" AS at
  FROM "StudentSurvey" s
  WHERE s."confirmedAt" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "StudentContinuationReceipt" r WHERE r."surveyId" = s.id)
  UNION ALL
  SELECT i."surveyId", COALESCE(i."verifiedAt", i."completedAt")
  FROM "StudentSignupIntent" i
  WHERE i."verifiedAt" IS NOT NULL OR i."completedAt" IS NOT NULL
  UNION ALL
  SELECT s.id, i."verifiedAt"
  FROM "StudentSurvey" s JOIN "AccountInvitation" i
    ON i.source->>'type' = 'tutee'
    AND (i.source->>'tokenHash' = s."tokenHash"
      OR left(i."sourceKey", length('tutee:' || s.id || ':')) = 'tutee:' || s.id || ':')
  WHERE i."verifiedAt" IS NOT NULL
  UNION ALL
  SELECT si."surveyId", i."verifiedAt"
  FROM "StudentSignupIntent" si JOIN "AccountInvitation" i
    ON i.source->>'type' = 'tutee-intent' AND i.source->>'id' = si.id
  WHERE i."verifiedAt" IS NOT NULL
), first_proof AS (
  SELECT id, min(at) AS at FROM evidence GROUP BY id
)
UPDATE "StudentSurvey" s SET "publicSignupEmailConfirmedAt" = p.at
FROM first_proof p WHERE s.id = p.id;

CREATE FUNCTION protect_public_signup_email_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publicSignupEmailConfirmedAt" IS NOT NULL
    AND NEW."publicSignupEmailConfirmedAt" IS DISTINCT FROM OLD."publicSignupEmailConfirmedAt" THEN
    RAISE EXCEPTION 'Public signup email confirmation cannot be reset' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER public_signup_email_confirmation_immutable BEFORE UPDATE ON "StudentSurvey"
  FOR EACH ROW EXECUTE FUNCTION protect_public_signup_email_confirmation();
