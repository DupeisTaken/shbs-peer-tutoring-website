-- Retain the tutoring-only suppression cause in safe planning recovery evidence.
-- This expands safe scalar facts, never admission compensation or consent authority.
BEGIN;
CREATE OR REPLACE FUNCTION public.recovery_planning_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(row_data)
 WHERE key IN ('id','planId','pairingId','cohortId','tuteeId','tutorId','termId','requestId','offerId','responseId','actorId','actorUserId','recipientUserId','parentRequestId','currentOfferId','userId','clientKey','status','state','kind','scope','stage','version','sourceVersion','sequence','date','originalDate','startMin','endMin','startsAt','endsAt','roomId','online','rescheduled','sourceInvalidated','scheduleOverride','calendarSuppressed','tutoringPauseSuppressed','cutoffAt','deliveredAt','deadline','respondedAt','acceptedAt','completedAt','createdAt','updatedAt','usedAt','revokedAt');
$$;

-- Calendar policy may appear in safe source evidence; reasons and capabilities stay excluded.
CREATE OR REPLACE FUNCTION public.recovery_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) || CASE WHEN row_data->'source'->>'type'='staff' THEN jsonb_build_object('registrationCodeId',row_data->'source'->>'id') ELSE '{}'::jsonb END FROM jsonb_each(row_data)
 WHERE key = 'id' OR key LIKE '%Id' OR key IN ('status','state','role','tutorAccessRevoked','tuteeMember','crewStatus','canTranslate','sessionVersion','profileVersion','historyIdentityRevision','updatedAt','usedAt','expiresAt','firstAssignedAt','verificationDueAt','confirmedAt','publicSignupEmailConfirmedAt','recoveryVoidedAt','preferredAssignedBlocks','workloadPreferenceVersion','roomVersion','roomShortageKey','roomMode','roomNeedsAssignment','scheduleConfirmed','dayOfWeek','startMin','endMin','subject','signupOpeningStateSince','signupFirstOpenedAt','continuationQuarterTransition','schedulingEffect');
$$;
COMMIT;
