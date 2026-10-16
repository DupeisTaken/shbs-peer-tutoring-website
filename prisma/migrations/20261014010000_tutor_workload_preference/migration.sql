ALTER TABLE "Tutor" ADD COLUMN "preferredAssignedBlocks" INTEGER,
                    ADD COLUMN "workloadPreferenceVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_preferredAssignedBlocks_range"
  CHECK ("preferredAssignedBlocks" IS NULL OR "preferredAssignedBlocks" BETWEEN 0 AND 4),
  ADD CONSTRAINT "Tutor_workloadPreferenceVersion_nonnegative" CHECK ("workloadPreferenceVersion" >= 0);

-- Existing inactive participants and every lifecycle/import path share the same rule.
-- Reactivation keeps zero until the tutor deliberately saves another preference.
UPDATE "Tutor" SET "preferredAssignedBlocks" = 0 WHERE status <> 'ACTIVE';
CREATE FUNCTION reset_inactive_tutor_workload_preference() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' THEN
    NEW."preferredAssignedBlocks" := 0;
    IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD."preferredAssignedBlocks" IS DISTINCT FROM 0) THEN
      NEW."workloadPreferenceVersion" := OLD."workloadPreferenceVersion" + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Tutor_inactive_workload_preference"
BEFORE INSERT OR UPDATE OF status, "preferredAssignedBlocks" ON "Tutor"
FOR EACH ROW EXECUTE FUNCTION reset_inactive_tutor_workload_preference();
