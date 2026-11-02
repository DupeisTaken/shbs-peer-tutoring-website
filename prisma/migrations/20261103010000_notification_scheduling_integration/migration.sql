-- Compose notification preferences with calendar and dated planning migrations.
-- Historical migrations remain immutable; both clean installs and upgrades end
-- with the same category routing, safe mail context and recovery evidence.
BEGIN;

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
  IF evt IN ('tutee_optout_requested','tutee_optout_cancelled','tutee_removed','student_assignment_updated','student_continuation_released',
    'student_availability_updated','student_request_recalled','student_signup_rejected','student_request_expired',
    'student_withdrawal_pending','student_withdrawal_approved','student_withdrawal_declined','student_schedule_review_pending',
    'student_schedule_review_approved','student_schedule_review_declined','request_invalidity_appeal_pending','room_assignment_needed') THEN RETURN 'tutoring'; END IF;
  IF evt IN ('attendance_cards_pending','attendance_room_reported','attendance_review_warning','attendance_review_penalty',
    'attendance_review_escalated','attendance_history_updated','record_corrected','tutee_feedback_received','tutee_card_appeal',
    'tutee_appeal_reviewed','meeting_absence_excused') THEN RETURN 'attendance'; END IF;
  IF evt IS DISTINCT FROM 'program_update' AND target = '/messages' THEN RETURN 'messages'; END IF;
  RETURN 'program';
END $$;

CREATE OR REPLACE FUNCTION notification_email_context(evt TEXT, source_context JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result JSONB := '{}'::jsonb; detail JSONB; allowed TEXT[]; fields JSONB;
BEGIN
  IF evt='message_received' THEN
    IF jsonb_typeof(source_context->'actorName')='string' AND length(source_context->>'actorName') BETWEEN 1 AND 160 AND btrim(source_context->>'actorName')<>'' THEN
      RETURN jsonb_build_object('emailDetail',jsonb_build_object(
        'en',btrim(source_context->>'actorName') || ' sent you a private message. Open your inbox to read it.',
        'zh',btrim(source_context->>'actorName') || ' 向您发送了私信。请打开收件箱阅读。'));
    END IF;
    RETURN NULL;
  END IF;
  IF evt='announcement_published' THEN
    IF jsonb_typeof(source_context->'announcementTitle')='string' AND length(source_context->>'announcementTitle') BETWEEN 1 AND 200
      AND btrim(source_context->>'announcementTitle')<>'' AND source_context->>'announcementAction' IN ('published','updated') THEN
      RETURN jsonb_build_object('emailDetail',jsonb_build_object(
        'en','Announcement “' || btrim(source_context->>'announcementTitle') || '” was ' || (source_context->>'announcementAction') || '. Open it to read the announcement.',
        'zh','公告《' || btrim(source_context->>'announcementTitle') || '》' || CASE WHEN source_context->>'announcementAction'='updated' THEN '已更新' ELSE '已发布' END || '。请打开查看。'));
    END IF;
    RETURN NULL;
  END IF;
  IF evt IN ('security_changed','information_changed') THEN
    allowed := CASE WHEN evt='security_changed' THEN ARRAY['password','twoFactorEnabled','twoFactorDisabled']
      ELSE ARRAY['name','firstName','lastName','preferredName','username','alternativeNames','role','suspended','reinstated','tutorAccessRevoked','tutorAccessRestored',
        'tuteeAdded','tuteeRemoved','translationEnabled','translationDisabled','crewStatus'] END;
    IF jsonb_typeof(source_context->'changedFields')='array' THEN
      SELECT jsonb_agg(field) INTO fields FROM (
        SELECT DISTINCT value #>> '{}' AS field FROM jsonb_array_elements(source_context->'changedFields')
        WHERE jsonb_typeof(value)='string' AND value #>> '{}' = ANY(allowed)
      ) selected;
      IF fields IS NOT NULL THEN result := jsonb_build_object('changedFields',fields); END IF;
    END IF;
    RETURN NULLIF(result,'{}'::jsonb);
  END IF;
  -- Calendar notices keep only structured schedule facts, never staff notes.
  IF evt IN ('school_calendar_changed','school_calendar_reset','school_calendar_upcoming') THEN
    RETURN jsonb_build_object('schoolDate',source_context->'schoolDate',
      'isSchoolDay',source_context->'isSchoolDay','timetableWeekday',source_context->'timetableWeekday',
      'calendarRevision',source_context->'calendarRevision','timeZone',source_context->'timeZone');
  END IF;
  IF evt IN ('attendance_cards_pending','attendance_history_updated') THEN
    result := jsonb_build_object('count',source_context->'count');
  ELSIF evt IN ('interview_scheduled','interview_upcoming','meeting_upcoming','tutoring_upcoming') THEN
    result := jsonb_build_object('startsAt',source_context->'startsAt','timeZone',source_context->'timeZone');
  END IF;
  IF notification_review_event(evt) OR evt IN (
    'account_suspended','account_reinstated','account_appeal_approved','account_appeal_declined',
    'qualification_approved','qualification_rejected','viewer_registered','tutor_setup_needed',
    'interview_panel_assigned','interview_scheduled','interview_approved',
    'management_approved','management_rejected','membership_optout_approved','membership_reentry_approved',
    'membership_declined','tutee_optout_cancelled','tutee_removed','attendance_room_reported',
    'attendance_review_warning','attendance_review_penalty','attendance_review_escalated','attendance_history_updated',
    'record_corrected','tutee_feedback_received','tutee_appeal_reviewed','student_assignment_updated',
    'student_availability_updated','student_request_recalled','student_signup_rejected','student_request_expired',
    'student_withdrawal_approved','student_withdrawal_declined','student_schedule_review_approved',
    'student_schedule_review_declined','tutor_reactivated','tutor_opted_out','meeting_absence_excused',
    'school_departure_updated','meeting_upcoming','interview_upcoming','tutoring_upcoming'
  ) THEN
    detail := COALESCE(source_context->'emailDetail',source_context->'inAppDetail');
    IF jsonb_typeof(detail)='object' AND jsonb_typeof(detail->'en')='string' AND jsonb_typeof(detail->'zh')='string'
      AND length(detail->>'en') BETWEEN 1 AND 1000 AND length(detail->>'zh') BETWEEN 1 AND 1000
      AND btrim(detail->>'en')<>'' AND btrim(detail->>'zh')<>'' THEN
      result := result || jsonb_build_object('emailDetail',jsonb_build_object('en',btrim(detail->>'en'),'zh',btrim(detail->>'zh')));
    END IF;
  END IF;
  RETURN NULLIF(result,'{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evt TEXT; cat TEXT;
BEGIN
  IF NEW."inAppOnly" THEN RETURN NEW; END IF;
  evt := COALESCE(NEW.event,CASE WHEN NEW.link='/messages' THEN 'message_received' ELSE 'program_update' END);
  cat := CASE NEW.category WHEN 'reviews' THEN 'review' WHEN 'messages' THEN 'messages' WHEN 'reminders' THEN 'reminder' ELSE 'info' END;
  PERFORM queue_account_email(NEW."userId",cat,evt,NULL,NEW.link,NEW.context);
  RETURN NEW;
END $$;

-- Only the newly introduced continuation event needs a domain-topic backfill.
-- Preserve completed mail state and all reviewer/participant transport evidence.
UPDATE "Notification" SET category='tutoring' WHERE event='student_continuation_released';
UPDATE "EmailDelivery" SET "preferenceTopic"='tutoring'
WHERE event='student_continuation_released' AND category IN ('info','information');

-- Retain planning snapshots, parent/alias traversal and clientKey while preserving
-- independent preference changes with their exact (userId, category) identity.
CREATE OR REPLACE FUNCTION recovery_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE CASE WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(OLD)) ELSE recovery_safe_row(to_jsonb(OLD)) END END;
 a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE CASE WHEN TG_TABLE_NAME IN ('SessionPlan','SessionPlanAssignment','SessionPlanCohort','SessionPlanParticipant','SessionPlanningSuggestion','SessionPlanningRequest','SessionPlanningOffer','SessionPlanningResponse','SessionPlanningReceipt','SessionNotice','SessionCalendarToken') THEN recovery_planning_safe_row(to_jsonb(NEW)) ELSE recovery_safe_row(to_jsonb(NEW)) END END;
 r JSONB := COALESCE(a,b);
 root_id TEXT;
 event_id TEXT;
 active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
 event_kind TEXT := NULLIF(current_setting('shbs.recovery_kind',true),'');
 record_id TEXT;
 changed_columns JSONB := CASE WHEN TG_OP='UPDATE' THEN
   (SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM to_jsonb(OLD)->key)
   WHEN TG_TABLE_NAME='NotificationPreference' THEN
   (SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(CASE WHEN TG_OP='INSERT' THEN to_jsonb(NEW) ELSE to_jsonb(OLD) END))
   ELSE NULL END;
BEGIN
 IF current_setting('shbs.recovery_compensating',true) = '1' THEN RETURN COALESCE(NEW,OLD); END IF;
 -- Mailbox challenges and guess counters are preparation, not a committed
 -- membership event. Consumption/expiry/generation changes remain visible.
 IF TG_TABLE_NAME IN ('RegistrationCode','AccountInvitation') AND TG_OP='UPDATE' AND a=b THEN RETURN NEW; END IF;
 FOR root_id IN
   SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
   WHERE t."recordId" IN (SELECT value #>> '{}' FROM
     (SELECT value FROM jsonb_each(COALESCE(a,'{}')) UNION ALL SELECT value FROM jsonb_each(COALESCE(b,'{}'))) refs
     WHERE jsonb_typeof(value) = 'string')
   UNION SELECT t."actionId" FROM "RecoveryTrackedEntity" t
     JOIN recovery_planning_references(TG_TABLE_NAME,COALESCE(to_jsonb(NEW),to_jsonb(OLD))) refs
       ON refs.entity=t.entity AND refs.record_id=t."recordId"
   UNION SELECT active_root WHERE active_root IS NOT NULL
   ORDER BY 1
 LOOP
   -- Serialize every descendant with apply. Serializable apply also retries or
   -- rejects a stale snapshot after a waiting writer commits.
   PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
   IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN
     -- A completed void cannot acquire new descendants through a stale writer.
     IF TG_OP <> 'DELETE' AND
       ((TG_TABLE_NAME IN ('Pairing','Session','QualificationGrant','SessionPlan') AND r->>'tutorId' = (SELECT "after"->'tutor'->>'id' FROM "RecoveryAction" WHERE id=root_id))
         OR (TG_TABLE_NAME='PairingTutee' AND EXISTS(SELECT 1 FROM "Pairing" p JOIN "RecoveryAction" ra ON ra.id=root_id WHERE p.id=r->>'pairingId' AND p."tutorId"=ra."after"->'tutor'->>'id')))
       AND NOT EXISTS(SELECT 1 FROM "TutorApplication" admitted JOIN "RecoveryAction" ra ON ra.id=root_id
         WHERE admitted.type='INITIAL' AND admitted.status='ACCEPTED' AND admitted."promotedTutorId"=ra."after"->'tutor'->>'id'
           AND (admitted.id<>ra."applicationId" OR EXISTS(SELECT 1 FROM "RecoveryAction" fresh
             WHERE fresh.id<>root_id AND fresh."applicationId"=admitted.id AND fresh."after"->'tutor'->>'id'=admitted."promotedTutorId"
               AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" voided WHERE voided."actionId"=fresh.id))))
       AND (SELECT "before"->'tutor'->>'status' IS DISTINCT FROM 'ACTIVE' FROM "RecoveryAction" WHERE id=root_id) THEN
       RAISE EXCEPTION 'Admission was voided; reload assignment state' USING ERRCODE='40001';
     END IF;
     CONTINUE;
   END IF;
   INSERT INTO "RecoveryFence"("actionId","revision") VALUES(root_id,1)
     ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
   event_id := md5(root_id || ':' || txid_current()::text);
   INSERT INTO "RecoveryEvent"("id","actionId","transactionId","kind") VALUES
    (event_id,root_id,txid_current()::text,COALESCE(CASE WHEN root_id=active_root THEN event_kind END,CASE WHEN TG_TABLE_NAME IN ('Pairing','PairingTutee') AND TG_OP='INSERT' THEN 'ASSIGNMENT' WHEN TG_TABLE_NAME='AccountInvitation' THEN 'INVITATION' ELSE 'UNSUPPORTED' END))
    ON CONFLICT ("actionId","transactionId") DO NOTHING;
   INSERT INTO "RecoveryChange"("actionId","eventId","entity","operation","recordKey","before","after","changedFields")
    VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,
      CASE WHEN TG_TABLE_NAME='NotificationPreference' THEN
        jsonb_build_object('userId',r->'userId','category',CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->'category' ELSE to_jsonb(NEW)->'category' END)
      ELSE COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key='id' OR key LIKE '%Id' OR (TG_TABLE_NAME='SessionPlanningReceipt' AND key='clientKey')),'{}') END,b,a,changed_columns);
   record_id := r->>'id';
   IF record_id IS NOT NULL THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,TG_TABLE_NAME,record_id) ON CONFLICT DO NOTHING;
   END IF;
   -- A participant/account alias can introduce a root after its plan was created.
   -- Retain the parent identity so subsequent cohort/offer changes remain causal.
   INSERT INTO "RecoveryTrackedEntity"("actionId",entity,"recordId")
     SELECT root_id,refs.entity,refs.record_id FROM recovery_planning_references(TG_TABLE_NAME,COALESCE(to_jsonb(NEW),to_jsonb(OLD))) refs
     WHERE refs.entity='SessionPlan' ON CONFLICT DO NOTHING;
   -- Pairing membership propagates scope to its student, but never to unrelated
   -- foreign keys such as the administrator, programme term or shared subject.
   IF TG_TABLE_NAME='PairingTutee' THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,'Tutee',r->>'tuteeId') ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;

COMMIT;
