BEGIN;
CREATE TABLE "RecoveryWorkflowDraft" (
  id TEXT PRIMARY KEY,
  "actionId" TEXT NOT NULL,
  "sourceSurveyId" TEXT NOT NULL,
  "sourceTuteeId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "ownerBindingHash" TEXT NOT NULL,
  answers JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING_OWNER_REVIEW',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "submittedSurveyId" TEXT UNIQUE,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((state='PENDING_OWNER_REVIEW' AND "submittedSurveyId" IS NULL AND "consumedAt" IS NULL)
    OR (state='CONSUMED' AND "submittedSurveyId" IS NOT NULL AND "consumedAt" IS NOT NULL))
);
CREATE INDEX "RecoveryWorkflowDraft_ownerUserId_state_idx" ON "RecoveryWorkflowDraft"("ownerUserId",state);
CREATE UNIQUE INDEX "RecoveryWorkflowDraft_actionId_sourceSurveyId_key" ON "RecoveryWorkflowDraft"("actionId","sourceSurveyId");
CREATE FUNCTION recovery_workflow_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.state<>'PENDING_OWNER_REVIEW' OR NEW.state<>'CONSUMED'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW."actionId" IS DISTINCT FROM OLD."actionId"
    OR NEW."sourceSurveyId" IS DISTINCT FROM OLD."sourceSurveyId" OR NEW."sourceTuteeId" IS DISTINCT FROM OLD."sourceTuteeId"
    OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW."ownerBindingHash" IS DISTINCT FROM OLD."ownerBindingHash"
    OR NEW.answers IS DISTINCT FROM OLD.answers OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version<>OLD.version+1 OR NEW."submittedSurveyId" IS NULL OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'Recovery workflow draft permits only exact owner adoption' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_workflow_draft_immutable BEFORE UPDATE OR DELETE ON "RecoveryWorkflowDraft"
  FOR EACH ROW EXECUTE FUNCTION recovery_workflow_draft_guard();
-- Draft review remains in-app only; keep SQL and application topic routing aligned.
CREATE OR REPLACE FUNCTION notification_topic(evt TEXT, recipient_role TEXT, target TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF notification_review_role(recipient_role, evt) THEN RETURN 'reviews'; END IF;
  IF evt IN ('primary_changed','secondary_added','secondary_removed','security_changed','information_changed',
    'viewer_registered','tutor_setup_needed','account_suspended','account_reinstated','account_appeal_requested','account_appeal_approved','account_appeal_declined') THEN RETURN 'account'; END IF;
  IF evt = 'message_received' THEN RETURN 'messages'; END IF;
  IF evt IN ('tutor_application_pending','qualification_requested','qualification_approved','qualification_rejected',
    'crew_application_pending','interview_panel_assigned','interview_scheduled','interview_approved') THEN RETURN 'applications'; END IF;
  IF evt IN ('interview_upcoming','meeting_upcoming','tutoring_upcoming') THEN RETURN 'reminders'; END IF;
  IF evt IN ('management_review_pending','management_head_review_pending','management_approved','management_rejected','translation_review_pending') THEN RETURN 'management'; END IF;
  IF evt = 'announcement_published' THEN RETURN 'announcements'; END IF;
  IF evt IN ('tutor_optout_requested','tutor_reentry_requested','crew_optout_requested','crew_reentry_requested',
    'membership_optout_approved','membership_reentry_approved','membership_declined','tutor_reactivated','tutor_opted_out','school_departure_updated') THEN RETURN 'membership'; END IF;
  IF evt IN ('tutee_optout_requested','tutee_optout_cancelled','tutee_removed','student_assignment_updated','student_continuation_released','recovery_workflow_draft',
    'student_availability_updated','student_request_recalled','student_signup_rejected','student_request_expired',
    'student_withdrawal_pending','student_withdrawal_approved','student_withdrawal_declined','student_schedule_review_pending',
    'student_schedule_review_approved','student_schedule_review_declined','request_invalidity_appeal_pending','room_assignment_needed') THEN RETURN 'tutoring'; END IF;
  IF evt IN ('attendance_cards_pending','attendance_room_reported','attendance_review_warning','attendance_review_penalty',
    'attendance_review_escalated','attendance_history_updated','record_corrected','tutee_feedback_received','tutee_card_appeal',
    'tutee_appeal_reviewed','meeting_absence_excused') THEN RETURN 'attendance'; END IF;
  IF evt IS DISTINCT FROM 'program_update' AND target = '/messages' THEN RETURN 'messages'; END IF;
  RETURN 'program';
END $$;

COMMIT;
