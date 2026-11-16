BEGIN;

-- Keep each dated identity and its consent/cancellation causes while an approved
-- refresh temporarily suppresses a future commitment.
ALTER TABLE public."SessionPlanCohort"
  ADD COLUMN "refreshSuppressed" BOOLEAN NOT NULL DEFAULT false;

CREATE TRIGGER scheduling_source_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public."ScheduledProgramRefresh"
  FOR EACH ROW EXECUTE FUNCTION public.scheduling_mark_dirty();
CREATE TRIGGER scheduling_source_truncated
  AFTER TRUNCATE ON public."ScheduledProgramRefresh"
  FOR EACH STATEMENT EXECUTE FUNCTION public.scheduling_mark_dirty();

CREATE OR REPLACE FUNCTION public.scheduling_verify_maintenance_triggers() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $body$
  SELECT current_setting('session_replication_role')='origin' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'Pairing','PairingGroup','PairingTutee','Tutor','Tutee','User',
      'TutorProfileOwnership','StudentProfileOwnership','Term','ProgramSettings','ScheduledProgramRefresh',
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

-- A previously warm publication must reconcile already-published future dates.
LOCK TABLE public."SchedulingMaintenanceState", public."SchedulingDirtyEvent"
IN ACCESS SHARE MODE;
UPDATE public."SchedulingMaintenanceState"
  SET "publicationVersion"=0,"settlementVersion"=0,"updatedAt"=clock_timestamp();
DO $body$
BEGIN
  IF NOT public.scheduling_verify_maintenance_triggers() THEN
    RAISE EXCEPTION 'Scheduled refresh invalidation is incomplete or not in origin mode';
  END IF;
END;
$body$;
COMMIT;
