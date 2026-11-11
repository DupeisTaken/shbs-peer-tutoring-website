-- Tutoring-only policy. Existing rows retain NOTICE and never become school closures.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
ALTER TABLE public."ProgramCalendarDay"
  ADD COLUMN "schedulingEffect" TEXT NOT NULL DEFAULT 'NOTICE',
  ADD CONSTRAINT "ProgramCalendarDay_schedulingEffect_check"
    CHECK ("schedulingEffect" IN ('NOTICE','PAUSE_REGULAR'));
ALTER TABLE public."SessionPlanParticipant"
  ADD COLUMN "tutoringPauseSuppressed" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.scheduling_mark_dirty() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE
  before_row jsonb;
  after_row jsonb;
  relevant_columns text[];
BEGIN
  IF TG_OP='UPDATE' THEN
    before_row := to_jsonb(OLD);
    after_row := to_jsonb(NEW);
    relevant_columns := CASE TG_TABLE_NAME
      WHEN 'User' THEN ARRAY['id','tutorId','studentId','role','suspendedAt',
        'tutorAccessRevoked','tuteeMember','mergedIntoId','personId',
        'recoveryVoidedAt','email','emailVerifiedAt']
      WHEN 'Tutor' THEN ARRAY['id','status','personId','historyIdentityRevision']
      WHEN 'Tutee' THEN ARRAY['id','status','personId','historyIdentityRevision']
      WHEN 'Term' THEN ARRAY['id','active','startDate','endDate']
      WHEN 'ProgramSettings' THEN ARRAY['id','timeZone']
      WHEN 'ProgramCalendarDay' THEN ARRAY['date','endDate','active','schedulingEffect']
      WHEN 'SchoolCalendarDay' THEN ARRAY['date','isSchoolDay',
        'timetableWeekday','active','scheduleRevision']
      ELSE NULL
    END;
    IF relevant_columns IS NOT NULL THEN
      SELECT jsonb_object_agg(key,value) INTO before_row
        FROM jsonb_each(before_row) WHERE key=ANY(relevant_columns);
      SELECT jsonb_object_agg(key,value) INTO after_row
        FROM jsonb_each(after_row) WHERE key=ANY(relevant_columns);
    ELSE
      -- Version/timestamp changes alone do not alter current scheduling sources.
      before_row := before_row - ARRAY['updatedAt','version',
        'sourceScheduleFingerprint'];
      after_row := after_row - ARRAY['updatedAt','version',
        'sourceScheduleFingerprint'];
    END IF;
    IF TG_TABLE_NAME='ProgramCalendarDay' THEN
      -- Reasons/editor revisions and informational ranges are not planning authority.
      IF before_row->>'schedulingEffect' <> 'PAUSE_REGULAR' OR before_row->>'active' <> 'true' THEN before_row := '{}'::jsonb; END IF;
      IF after_row->>'schedulingEffect' <> 'PAUSE_REGULAR' OR after_row->>'active' <> 'true' THEN after_row := '{}'::jsonb; END IF;
    END IF;
    IF before_row IS NOT DISTINCT FROM after_row THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public."SchedulingDirtyEvent" ("sourceTable") VALUES (TG_TABLE_NAME);
  IF TG_OP='TRUNCATE' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$body$;

-- Acquire the new source's DDL fence before metadata, matching earlier bridges.
CREATE TRIGGER scheduling_source_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public."ProgramCalendarDay"
  FOR EACH ROW EXECUTE FUNCTION public.scheduling_mark_dirty();
CREATE TRIGGER scheduling_source_truncated
  AFTER TRUNCATE ON public."ProgramCalendarDay"
  FOR EACH STATEMENT EXECUTE FUNCTION public.scheduling_mark_dirty();

CREATE OR REPLACE FUNCTION public.scheduling_verify_maintenance_triggers() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $body$
  SELECT current_setting('session_replication_role')='origin' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'Pairing','PairingGroup','PairingTutee','Tutor','Tutee','User',
      'TutorProfileOwnership','StudentProfileOwnership','Term','ProgramSettings',
      'ProgramCalendarDay','SchoolCalendarDay','SchoolDeparture','PolicyAcceptance','StudentContinuationPairing',
      'StudentContinuationAssignment','SessionPlanContinuationMember',
      'SessionPlan','SessionPlanAssignment','SessionPlanCohort',
      'SessionPlanParticipant','SessionPlanningRequest','SessionPlanningOffer',
      'SessionPlanningResponse','Room','RoomUnavailability',
      'HistoryRowOwnership','PairingExecutionSuccessor','ParticipantConsolidation',
      'PersonCombineReceipt','RetiredHistoryOwnership','SessionParticipantExecution',
      'SessionPlanExecution','SessionResponseExecution',
      'StudentRequestExecutionAssignment','StudentSurvey'
    ]) AS required(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass(format('public.%I',required.name))
        AND t.tgname='scheduling_source_dirty'
        AND NOT t.tgisinternal AND t.tgtype=29
        AND t.tgenabled IN ('O','A') AND t.tgqual IS NULL
        AND t.tgattr=''::int2vector AND t.tgconstraint=0
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND t.tgnargs=0 AND t.tgfoid='public.scheduling_mark_dirty()'::regprocedure
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass(format('public.%I',required.name))
        AND t.tgname='scheduling_source_truncated'
        AND NOT t.tgisinternal AND t.tgtype=32
        AND t.tgenabled IN ('O','A') AND t.tgqual IS NULL
        AND t.tgattr=''::int2vector AND t.tgconstraint=0
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND t.tgnargs=0 AND t.tgfoid='public.scheduling_mark_dirty()'::regprocedure
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('scheduling_metadata_deleted',8,'deleted_events'),
      ('scheduling_metadata_truncated',32,NULL)
    ) AS required(name,kind,old_table)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='public."SchedulingDirtyEvent"'::regclass
        AND t.tgname=required.name AND t.tgtype=required.kind
        AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
        AND t.tgqual IS NULL AND t.tgattr=''::int2vector
        AND t.tgoldtable::text IS NOT DISTINCT FROM required.old_table
        AND t.tgnargs=0 AND t.tgconstraint=0
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND t.tgfoid='public.scheduling_invalidate_deleted_metadata()'::regprocedure
    )
  )
$body$;

-- Preserve dirty events/retries and invalidate old clean generations atomically.
LOCK TABLE public."SchedulingMaintenanceState", public."SchedulingDirtyEvent"
IN ACCESS SHARE MODE;
UPDATE public."SchedulingMaintenanceState"
  SET "publicationVersion"=0,"settlementVersion"=0,"updatedAt"=clock_timestamp();
DO $body$
BEGIN
  IF NOT public.scheduling_verify_maintenance_triggers() THEN
    RAISE EXCEPTION 'Tutoring policy invalidation is incomplete or not in origin mode';
  END IF;
END;
$body$;
COMMIT;
