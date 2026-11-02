-- Admission recovery requires complete journal coverage for every domain table.
-- A schedule can depend on a tracked approving account; keep such later work
-- visible and unsupported rather than excluding this table from the safety gate.
CREATE TRIGGER recovery_change_journal
  AFTER INSERT OR UPDATE OR DELETE ON "ScheduledProgramRefresh"
  FOR EACH ROW EXECUTE FUNCTION recovery_capture_change();

-- Preserve conservative evidence when upgrading an earlier candidate of this
-- release. Schedule rows are retained by the application. A no-op update journals
-- any existing row linked to a tracked admission without changing its settings,
-- version, execution time or authorization. Unrelated rows create no recovery event.
UPDATE "ScheduledProgramRefresh" SET "id" = "id";
