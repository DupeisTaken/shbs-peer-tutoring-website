-- Keep calendar mail on the existing optional information channel. Only structured
-- schedule facts cross the mail boundary; notes and participant data never do.
CREATE OR REPLACE FUNCTION notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evt TEXT;
  safe_context JSONB;
BEGIN
  IF NEW."inAppOnly" THEN RETURN NEW; END IF;
  evt := COALESCE(NEW.event, CASE WHEN NEW.link = '/messages' THEN 'message_received' ELSE 'program_update' END);
  IF evt IN ('attendance_cards_pending', 'attendance_history_updated') THEN
    safe_context := jsonb_build_object('count', NEW.context->'count');
  ELSIF evt = 'interview_scheduled' THEN
    safe_context := jsonb_build_object('startsAt', NEW.context->'startsAt', 'timeZone', NEW.context->'timeZone');
  ELSIF evt IN ('school_calendar_changed', 'school_calendar_reset', 'school_calendar_upcoming') THEN
    safe_context := jsonb_build_object(
      'schoolDate', NEW.context->'schoolDate',
      'isSchoolDay', NEW.context->'isSchoolDay',
      'timetableWeekday', NEW.context->'timetableWeekday',
      'calendarRevision', NEW.context->'calendarRevision',
      'timeZone', NEW.context->'timeZone'
    );
  ELSE safe_context := NULL;
  END IF;
  PERFORM queue_account_email(NEW."userId", CASE WHEN evt = 'message_received' THEN 'messages' ELSE 'info' END,
    evt, NULL, NEW.link, safe_context);
  RETURN NEW;
END $$;
