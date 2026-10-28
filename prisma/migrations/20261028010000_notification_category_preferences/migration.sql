BEGIN;

ALTER TABLE "Notification" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'program';
ALTER TABLE "EmailDelivery" ADD COLUMN "preferenceTopic" TEXT;
CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  category TEXT NOT NULL,
  "badgeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", category),
  CONSTRAINT "NotificationPreference_category_check" CHECK (category IN
    ('messages','reviews','applications','tutoring','attendance','membership','account','announcements','management','program','reminders'))
);
CREATE INDEX "Notification_userId_readAt_category_idx" ON "Notification"("userId", "readAt", category);

-- Domain topics are exhaustive for maintained identities. A reviewer copy has its
-- own topic; a participant copy of the same pending event keeps its domain topic.
CREATE FUNCTION notification_topic(evt TEXT, recipient_role TEXT, target TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
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
  IF evt IN ('tutee_optout_requested','tutee_optout_cancelled','tutee_removed','student_assignment_updated',
    'student_availability_updated','student_request_recalled','student_signup_rejected','student_request_expired',
    'student_withdrawal_pending','student_withdrawal_approved','student_withdrawal_declined','student_schedule_review_pending',
    'student_schedule_review_approved','student_schedule_review_declined','request_invalidity_appeal_pending','room_assignment_needed') THEN RETURN 'tutoring'; END IF;
  IF evt IN ('attendance_cards_pending','attendance_room_reported','attendance_review_warning','attendance_review_penalty',
    'attendance_review_escalated','attendance_history_updated','record_corrected','tutee_feedback_received','tutee_card_appeal',
    'tutee_appeal_reviewed','meeting_absence_excused') THEN RETURN 'attendance'; END IF;
  IF evt IS DISTINCT FROM 'program_update' AND target = '/messages' THEN RETURN 'messages'; END IF;
  RETURN 'program';
END $$;

-- An absent override inherits the previous opt-in exactly; this also supports old
-- clients and avoids populating eleven rows for every newly registered account.
CREATE FUNCTION notification_email_enabled(uid TEXT, topic TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT p."emailEnabled" FROM "NotificationPreference" p WHERE p."userId"=uid AND p.category=topic),
    CASE topic WHEN 'messages' THEN u."emailMessages" WHEN 'reviews' THEN u."emailReviewRequests"
      WHEN 'reminders' THEN u."emailEventReminders" ELSE u."emailInfo" END, false)
  FROM "User" u WHERE u.id=uid;
$$;

CREATE FUNCTION notification_topic_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient_role TEXT;
BEGIN
  SELECT CASE WHEN "suspendedAt" IS NULL AND "mergedIntoId" IS NULL THEN role::text ELSE NULL END INTO recipient_role FROM "User" WHERE id=NEW."userId";
  NEW.category := notification_topic(NEW.event, recipient_role, NEW.link);
  RETURN NEW;
END $$;
CREATE TRIGGER notification_topic_before_insert BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION notification_topic_insert();
UPDATE "Notification" n SET category=notification_topic(n.event,
  CASE WHEN u."suspendedAt" IS NULL AND u."mergedIntoId" IS NULL THEN u.role::text ELSE NULL END,n.link)
FROM "User" u WHERE u.id=n."userId";
-- Retain the original transport's reviewer/participant distinction in historical
-- outbox rows, rather than guessing it from the recipient's current role.
UPDATE "EmailDelivery" SET "preferenceTopic"=CASE category
  WHEN 'review' THEN 'reviews' WHEN 'reminder' THEN 'reminders' WHEN 'messages' THEN 'messages'
  ELSE notification_topic(event,NULL,destination) END
WHERE category IN ('review','reminder','messages','info','information');

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

CREATE OR REPLACE FUNCTION queue_account_email(uid TEXT,cat TEXT,evt TEXT,old_primary TEXT,target TEXT,safe_context JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE u "User"%ROWTYPE; topic TEXT;
BEGIN
  IF cat<>'security' AND NOT EXISTS(SELECT 1 FROM "ProgramSettings" WHERE id='program' AND "emailNotificationsEnabled") THEN RETURN; END IF;
  SELECT * INTO u FROM "User" WHERE id=uid;
  IF NOT FOUND OR u."mergedIntoId" IS NOT NULL THEN RETURN; END IF;
  IF cat='review' AND (u."suspendedAt" IS NOT NULL OR NOT notification_review_role(u.role::text,evt)) THEN RETURN; END IF;
  topic := CASE cat WHEN 'security' THEN NULL WHEN 'review' THEN 'reviews' WHEN 'reminder' THEN 'reminders'
    WHEN 'messages' THEN 'messages' ELSE notification_topic(evt,NULL,target) END;
  IF cat<>'security' AND (cat NOT IN ('messages','info','information','review','reminder') OR NOT notification_email_enabled(uid,topic)) THEN RETURN; END IF;
  INSERT INTO "EmailDelivery" (id,"userId",category,"preferenceTopic",event,recipient,"previousPrimary",destination,context)
  SELECT gen_random_uuid()::text,uid,cat,topic,evt,r.email,COALESCE(r.email=old_primary,false),target,notification_email_context(evt,safe_context)
  FROM (SELECT email FROM "AccountEmail" WHERE "userId"=uid AND "verifiedAt" IS NOT NULL
    AND (email=u.email OR u."emailSecondaryRecipients") UNION SELECT old_primary WHERE old_primary IS NOT NULL) r;
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

-- Independent conditions ensure simultaneous primary-email and password/2FA
-- changes each produce their own essential notice, with no secret values stored.
CREATE OR REPLACE FUNCTION account_update_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" THEN
    UPDATE "EmailVerificationCode" SET "consumedAt"=CURRENT_TIMESTAMP WHERE "userId"=NEW.id AND "consumedAt" IS NULL;
    UPDATE "PasswordResetToken" SET "consumedAt"=CURRENT_TIMESTAMP WHERE "userId"=NEW.id AND "consumedAt" IS NULL;
    changes := array_append(changes,'password');
  END IF;
  IF OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled" THEN
    changes := array_append(changes,CASE WHEN NEW."twoFactorEnabled" THEN 'twoFactorEnabled' ELSE 'twoFactorDisabled' END);
  END IF;
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    PERFORM queue_account_email(NEW.id,'security','primary_changed',CASE WHEN OLD."emailVerifiedAt" IS NOT NULL THEN OLD.email ELSE NULL END);
  END IF;
  IF cardinality(changes)>0 THEN PERFORM queue_account_email(NEW.id,'security','security_changed',NULL,NULL,jsonb_build_object('changedFields',changes)); END IF;
  changes := ARRAY[]::TEXT[];
  IF OLD.name IS DISTINCT FROM NEW.name THEN changes:=array_append(changes,'name'); END IF;
  IF OLD."firstName" IS DISTINCT FROM NEW."firstName" THEN changes:=array_append(changes,'firstName'); END IF;
  IF OLD."lastName" IS DISTINCT FROM NEW."lastName" THEN changes:=array_append(changes,'lastName'); END IF;
  IF OLD."preferredName" IS DISTINCT FROM NEW."preferredName" THEN changes:=array_append(changes,'preferredName'); END IF;
  IF OLD.username IS DISTINCT FROM NEW.username THEN changes:=array_append(changes,'username'); END IF;
  IF OLD."alternativeNames" IS DISTINCT FROM NEW."alternativeNames" THEN changes:=array_append(changes,'alternativeNames'); END IF;
  IF OLD.role IS DISTINCT FROM NEW.role THEN changes:=array_append(changes,'role'); END IF;
  IF OLD."suspendedAt" IS DISTINCT FROM NEW."suspendedAt" THEN changes:=array_append(changes,CASE WHEN NEW."suspendedAt" IS NULL THEN 'reinstated' ELSE 'suspended' END); END IF;
  IF OLD."tutorAccessRevoked" IS DISTINCT FROM NEW."tutorAccessRevoked" THEN changes:=array_append(changes,CASE WHEN NEW."tutorAccessRevoked" THEN 'tutorAccessRevoked' ELSE 'tutorAccessRestored' END); END IF;
  IF OLD."tuteeMember" IS DISTINCT FROM NEW."tuteeMember" THEN changes:=array_append(changes,CASE WHEN NEW."tuteeMember" THEN 'tuteeAdded' ELSE 'tuteeRemoved' END); END IF;
  IF OLD."canTranslate" IS DISTINCT FROM NEW."canTranslate" THEN changes:=array_append(changes,CASE WHEN NEW."canTranslate" THEN 'translationEnabled' ELSE 'translationDisabled' END); END IF;
  IF OLD."crewStatus" IS DISTINCT FROM NEW."crewStatus" THEN changes:=array_append(changes,'crewStatus'); END IF;
  IF cardinality(changes)>0 THEN PERFORM queue_account_email(NEW.id,'info','information_changed',NULL,NULL,jsonb_build_object('changedFields',changes)); END IF;
  RETURN NEW;
END $$;

COMMIT;
