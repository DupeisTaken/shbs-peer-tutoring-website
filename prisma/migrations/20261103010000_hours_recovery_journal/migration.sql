BEGIN;

-- These reporting tables were introduced after the recovery coverage migration.
-- Reuse canonical operator/fixture coverage, but never replace an unknown guard.
-- Keep this installer self-contained: planning may be deployed independently.
CREATE FUNCTION recovery_install_hours_journal() RETURNS void LANGUAGE plpgsql AS $$
DECLARE table_name TEXT; existing RECORD;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['MonthlyHoursSchedule','MonthlyHoursReport','SchoolHoursSchedule','SchoolHoursReport'] LOOP
   SELECT * INTO existing FROM pg_trigger
     WHERE tgrelid=format('public.%I',table_name)::regclass AND tgname='recovery_change_journal';
   IF FOUND THEN
     IF existing.tgfoid<>'recovery_capture_change()'::regprocedure OR existing.tgtype<>29
       OR existing.tgenabled NOT IN ('O','A') OR existing.tgisinternal
       OR existing.tgnargs<>0 OR existing.tgqual IS NOT NULL
       OR cardinality(existing.tgattr::smallint[])<>0 OR existing.tgconstraint<>0 THEN
       RAISE EXCEPTION 'Recovery journal trigger on % is incompatible; inspect coverage before retrying this migration',table_name USING ERRCODE='23514';
     END IF;
   ELSE
     EXECUTE format('CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION recovery_capture_change()',table_name);
   END IF;
 END LOOP;
END $$;

SELECT recovery_install_hours_journal();
COMMIT;
