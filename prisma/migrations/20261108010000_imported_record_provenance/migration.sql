-- Prospective provenance only: older imports cannot be identified by names,
-- dates or inactive status without changing legitimate native correction rights.
CREATE TABLE "ImportedRecordProvenance" (
  "entity" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportedRecordProvenance_pkey" PRIMARY KEY ("entity", "recordId")
);

-- Changing a tracked source's archive boundary is an unsupported recovery
-- consequence. Never let automatic compensation silently make it operational.
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "ImportedRecordProvenance"
FOR EACH ROW EXECUTE FUNCTION recovery_capture_change();
