BEGIN;

ALTER TABLE "User" ADD COLUMN "emailReviewRequests" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailEventReminders" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailDelivery" ADD COLUMN "reminderKey" TEXT;
CREATE UNIQUE INDEX "EmailDelivery_reminderKey_key" ON "EmailDelivery"("reminderKey");

-- The same pending event may notify both its participant and its authorized reviewer.
-- Only a reviewer's copy belongs to the independently opted-in review category.
CREATE FUNCTION notification_review_event(evt TEXT) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT evt IN (
    'tutor_application_pending', 'qualification_requested', 'crew_application_pending',
    'management_review_pending', 'management_head_review_pending', 'translation_review_pending',
    'tutor_optout_requested', 'tutor_reentry_requested', 'crew_optout_requested', 'crew_reentry_requested',
    'tutee_optout_requested', 'attendance_cards_pending', 'account_appeal_requested', 'tutee_card_appeal',
    'student_withdrawal_pending', 'student_schedule_review_pending', 'request_invalidity_appeal_pending'
  );
$$;
CREATE FUNCTION notification_review_role(recipient_role TEXT, evt TEXT) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT notification_review_event(evt) AND (recipient_role = 'HEAD' OR (recipient_role = 'ADMIN' AND evt NOT IN (
    'management_head_review_pending', 'crew_application_pending', 'tutor_optout_requested',
    'tutor_reentry_requested', 'crew_optout_requested', 'crew_reentry_requested'
  )));
$$;

-- Copy only audited factual bilingual detail. Never copy Notification.body, names
-- from arbitrary profile JSON, contact fields, appeal text, or decision notes.
CREATE FUNCTION notification_email_context(evt TEXT, source_context JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result JSONB := '{}'::jsonb; detail JSONB;
BEGIN
  IF evt IN ('attendance_cards_pending', 'attendance_history_updated') THEN
    result := jsonb_build_object('count', source_context->'count');
  ELSIF evt IN ('interview_scheduled', 'interview_upcoming', 'meeting_upcoming', 'tutoring_upcoming') THEN
    result := jsonb_build_object('startsAt', source_context->'startsAt', 'timeZone', source_context->'timeZone');
  END IF;
  IF notification_review_event(evt) OR evt IN (
    'qualification_approved', 'qualification_rejected', 'viewer_registered', 'tutor_setup_needed',
    'interview_panel_assigned', 'interview_scheduled', 'interview_approved',
    'management_approved', 'management_rejected', 'membership_optout_approved', 'membership_reentry_approved',
    'membership_declined', 'tutee_optout_cancelled', 'tutee_removed', 'attendance_room_reported',
    'attendance_review_warning', 'attendance_review_penalty', 'attendance_review_escalated', 'attendance_history_updated',
    'record_corrected', 'tutee_feedback_received', 'tutee_appeal_reviewed', 'student_assignment_updated',
    'student_availability_updated', 'student_request_recalled', 'student_signup_rejected', 'student_request_expired',
    'student_withdrawal_approved', 'student_withdrawal_declined', 'student_schedule_review_approved',
    'student_schedule_review_declined', 'tutor_reactivated', 'tutor_opted_out', 'meeting_absence_excused',
    'school_departure_updated', 'meeting_upcoming', 'interview_upcoming', 'tutoring_upcoming'
  ) THEN
    detail := COALESCE(source_context->'emailDetail', source_context->'inAppDetail');
    IF jsonb_typeof(detail) = 'object' AND jsonb_typeof(detail->'en') = 'string'
      AND jsonb_typeof(detail->'zh') = 'string'
      AND length(btrim(detail->>'en')) BETWEEN 1 AND 1000
      AND length(btrim(detail->>'zh')) BETWEEN 1 AND 1000 THEN
      result := result || jsonb_build_object('emailDetail', jsonb_build_object(
        'en', btrim(detail->>'en'), 'zh', btrim(detail->>'zh')));
    END IF;
  END IF;
  RETURN NULLIF(result, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION queue_account_email(uid TEXT, cat TEXT, evt TEXT, old_primary TEXT, target TEXT, safe_context JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  IF cat <> 'security' AND NOT EXISTS (
    SELECT 1 FROM "ProgramSettings" WHERE id = 'program' AND "emailNotificationsEnabled"
  ) THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id = uid;
  IF NOT FOUND OR u."mergedIntoId" IS NOT NULL THEN RETURN; END IF;
  IF cat = 'review' AND (u."suspendedAt" IS NOT NULL OR NOT notification_review_role(u.role::text, evt)) THEN RETURN; END IF;
  IF NOT (CASE cat WHEN 'security' THEN true WHEN 'messages' THEN u."emailMessages"
    WHEN 'info' THEN u."emailInfo" WHEN 'review' THEN u."emailReviewRequests"
    WHEN 'reminder' THEN u."emailEventReminders" ELSE false END) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id, "userId", category, event, recipient, "previousPrimary", destination, context)
  SELECT gen_random_uuid()::text, uid, cat, evt, r.email, COALESCE(r.email = old_primary, false), target,
    notification_email_context(evt, safe_context)
  FROM (
    SELECT email FROM "AccountEmail" WHERE "userId" = uid AND "verifiedAt" IS NOT NULL
      AND (email = u.email OR u."emailSecondaryRecipients")
    UNION SELECT old_primary WHERE old_primary IS NOT NULL
  ) r;
END $$;

CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evt TEXT; cat TEXT; u "User"%ROWTYPE;
BEGIN
  IF NEW."inAppOnly" THEN RETURN NEW; END IF;
  evt := COALESCE(NEW.event, CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END);
  SELECT * INTO u FROM "User" WHERE id = NEW."userId";
  cat := CASE WHEN evt = 'message_received' THEN 'messages'
    WHEN notification_review_role(u.role::text, evt) THEN 'review' ELSE 'info' END;
  PERFORM queue_account_email(NEW."userId", cat, evt, NULL, NEW.link, NEW.context);
  RETURN NEW;
END $$;

-- Default opt-out must not resurrect already queued review requests on upgrade.
-- Keep delivery evidence, and do not invent historical detail from current records.
UPDATE "EmailDelivery" d SET category = 'review',
  status = CASE WHEN d.status IN ('PENDING', 'FAILED') THEN 'SKIPPED' ELSE d.status END,
  "completedAt" = CASE WHEN d.status IN ('PENDING', 'FAILED') THEN NOW() ELSE d."completedAt" END,
  "leaseUntil" = CASE WHEN d.status IN ('PENDING', 'FAILED') THEN NULL ELSE d."leaseUntil" END
FROM "User" u WHERE d."userId" = u.id AND d.category IN ('info', 'information')
  AND notification_review_role(u.role::text, d.event);

COMMIT;
