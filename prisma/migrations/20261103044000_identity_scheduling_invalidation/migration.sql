-- Bridge 030000 scheduling maintenance and 043000
-- identity authority journaling. This bridge changes derived invalidation, not
-- permission, participation, consent, private-history or recovery authority.
BEGIN;
SET LOCAL search_path=pg_catalog,public;

-- Acquire the source DDL locks before touching metadata, as source writers append
-- dirty events before a maintenance transaction can acknowledge them. This mode
-- fences concurrent INSERT/UPDATE/DELETE and is the mode CREATE TRIGGER needs;
-- ordinary source reads remain possible. Missing dependencies fail atomically.
LOCK TABLE
  public."HistoryRowOwnership",
  public."PairingExecutionSuccessor",
  public."ParticipantConsolidation",
  public."PersonCombineReceipt",
  public."RetiredHistoryOwnership",
  public."SessionParticipantExecution",
  public."SessionPlanExecution",
  public."SessionResponseExecution",
  public."StudentRequestExecutionAssignment",
  public."StudentSurvey"
IN SHARE ROW EXCLUSIVE MODE;

-- Reuse the append-only function from 030000. In particular, do not add a WHEN
-- condition, column-restricted UPDATE, or recovery-compensation bypass. Its
-- semantic comparison retains revision, assignment, source-owner and release
-- changes on these tables; only the existing generic metadata exclusions apply.
DO $body$
DECLARE source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'HistoryRowOwnership','PairingExecutionSuccessor','ParticipantConsolidation',
    'PersonCombineReceipt','RetiredHistoryOwnership','SessionParticipantExecution',
    'SessionPlanExecution','SessionResponseExecution',
    'StudentRequestExecutionAssignment','StudentSurvey'
  ] LOOP
    EXECUTE format('CREATE TRIGGER scheduling_source_dirty '
      'AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
      'EXECUTE FUNCTION public.scheduling_mark_dirty()',source_table);
    EXECUTE format('CREATE TRIGGER scheduling_source_truncated '
      'AFTER TRUNCATE ON public.%I FOR EACH STATEMENT '
      'EXECUTE FUNCTION public.scheduling_mark_dirty()',source_table);
  END LOOP;
END;
$body$;

-- Full dependency union: all 25 original sources plus the 10 identity/request
-- sources. Keep the same unconditional origin-trigger and metadata-delete
-- contracts as 030000. An incomplete installation cannot certify a warm state.
CREATE OR REPLACE FUNCTION public.scheduling_verify_maintenance_triggers() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $body$
  SELECT current_setting('session_replication_role')='origin' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'Pairing','PairingGroup','PairingTutee','Tutor','Tutee','User',
      'TutorProfileOwnership','StudentProfileOwnership','Term','ProgramSettings',
      'SchoolCalendarDay','SchoolDeparture','PolicyAcceptance','StudentContinuationPairing',
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

-- Use the same metadata relation-lock order/mode as verifiedState() in 030000's
-- owning helper. Avoid TRUNCATE or deleting dirty events: concurrent source
-- invalidations and per-request retries remain intact. Updating existing rows
-- changes their xmin, so an in-flight acknowledgement with an older stateRevision
-- cannot restore a clean watermark after this commit. A first publisher racing
-- an absent state row can only insert the helper's obsolete default watermark.
LOCK TABLE public."SchedulingMaintenanceState", public."SchedulingDirtyEvent"
IN ACCESS SHARE MODE;
UPDATE public."SchedulingMaintenanceState"
  SET "publicationVersion"=0,"settlementVersion"=0,
      "updatedAt"=clock_timestamp();

DO $body$
BEGIN
  IF NOT public.scheduling_verify_maintenance_triggers() THEN
    RAISE EXCEPTION 'Scheduling identity invalidation bridge is incomplete or not in origin mode';
  END IF;
END;
$body$;
COMMIT;
