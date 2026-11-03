-- Derived scheduling accelerators only. Missing/versioned state is rebuilt from
-- current sources; no permission, consent or historical scheduling truth lives here.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
CREATE TABLE public."SchedulingMaintenanceState" (
  "id" TEXT NOT NULL DEFAULT 'program',
  "publicationVersion" INTEGER NOT NULL DEFAULT 0,
  "settlementVersion" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TEXT NOT NULL DEFAULT '',
  "prepareEnd" TEXT NOT NULL DEFAULT '',
  "timeZone" TEXT NOT NULL DEFAULT '',
  "unavailable" INTEGER NOT NULL DEFAULT 0,
  "normalized" INTEGER NOT NULL DEFAULT 0,
  "settlementBatchActive" BOOLEAN NOT NULL DEFAULT false,
  "settlementBatchExhausted" BOOLEAN NOT NULL DEFAULT false,
  "settlementCursor" TEXT NOT NULL DEFAULT '',
  "settlementEventIds" BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  "settlementRequestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchedulingMaintenanceState_pkey" PRIMARY KEY ("id")
);
CREATE TABLE public."SchedulingDirtyEvent" (
  "id" BIGSERIAL NOT NULL,
  "sourceTable" TEXT NOT NULL,
  "requestId" TEXT,
  "publicationPending" BOOLEAN NOT NULL DEFAULT true,
  "settlementPending" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchedulingDirtyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SchedulingDirtyEvent_publicationPending_id_idx"
  ON public."SchedulingDirtyEvent"("publicationPending","id");
CREATE INDEX "SchedulingDirtyEvent_settlementPending_id_idx"
  ON public."SchedulingDirtyEvent"("settlementPending","id");
CREATE UNIQUE INDEX "SchedulingDirtyEvent_requestId_key"
  ON public."SchedulingDirtyEvent"("requestId");

-- Append rather than locking a shared revision row: source writers can already
-- hold profile/pairing locks before taking the planning fence. This avoids the
-- reverse lock edge. Do not honor recovery capture suppression here: compensation
-- changes current scheduling sources and must invalidate the accelerator too.
CREATE FUNCTION public.scheduling_mark_dirty() RETURNS trigger
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
    IF before_row IS NOT DISTINCT FROM after_row THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public."SchedulingDirtyEvent" ("sourceTable") VALUES (TG_TABLE_NAME);
  IF TG_OP='TRUNCATE' THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$body$;

-- Removing still-pending invalidation evidence must not leave a clean watermark.
-- Normal acknowledgements only delete rows after both consumers finish them;
-- they therefore do not reset state. Source writers only INSERT and never take
-- this metadata-row lock, retaining the source/planning lock order above.
CREATE FUNCTION public.scheduling_invalidate_deleted_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    UPDATE public."SchedulingMaintenanceState"
      SET "publicationVersion"=0,"settlementVersion"=0;
  ELSIF EXISTS (SELECT 1 FROM deleted_events
    WHERE "publicationPending" OR "settlementPending") THEN
    UPDATE public."SchedulingMaintenanceState"
      SET "publicationVersion"=0,"settlementVersion"=0;
  END IF;
  RETURN NULL;
END;
$body$;
CREATE TRIGGER scheduling_metadata_deleted
  AFTER DELETE ON public."SchedulingDirtyEvent"
  REFERENCING OLD TABLE AS deleted_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.scheduling_invalidate_deleted_metadata();
CREATE TRIGGER scheduling_metadata_truncated
  AFTER TRUNCATE ON public."SchedulingDirtyEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION public.scheduling_invalidate_deleted_metadata();

DO $body$
DECLARE source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'Pairing','PairingGroup','PairingTutee','Tutor','Tutee','User',
    'TutorProfileOwnership','StudentProfileOwnership','Term','ProgramSettings',
    'SchoolCalendarDay','SchoolDeparture','PolicyAcceptance','StudentContinuationPairing',
    'StudentContinuationAssignment','SessionPlanContinuationMember',
    'SessionPlan','SessionPlanAssignment','SessionPlanCohort',
    'SessionPlanParticipant','SessionPlanningRequest','SessionPlanningOffer',
    'SessionPlanningResponse','Room','RoomUnavailability'
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

-- A warm watermark is usable only with unconditional, normally enabled row
-- triggers on the complete dependency set. Missing, disabled, conditional or
-- wrong-function triggers fail closed instead of silently trusting stale state.
CREATE FUNCTION public.scheduling_verify_maintenance_triggers() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $body$
  SELECT current_setting('session_replication_role')='origin' AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'Pairing','PairingGroup','PairingTutee','Tutor','Tutee','User',
      'TutorProfileOwnership','StudentProfileOwnership','Term','ProgramSettings',
      'SchoolCalendarDay','SchoolDeparture','PolicyAcceptance','StudentContinuationPairing',
      'StudentContinuationAssignment','SessionPlanContinuationMember',
      'SessionPlan','SessionPlanAssignment','SessionPlanCohort',
      'SessionPlanParticipant','SessionPlanningRequest','SessionPlanningOffer',
      'SessionPlanningResponse','Room','RoomUnavailability'
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
COMMIT;
