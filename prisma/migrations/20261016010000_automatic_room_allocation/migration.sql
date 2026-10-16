-- Preserve every existing reservation. Deployment neither allocates nor sends shortages.
ALTER TYPE "ProgramFeatureKey" ADD VALUE 'AUTO_ASSIGN_ROOMS';
CREATE TYPE "PairingRoomMode" AS ENUM ('AUTO', 'FIXED', 'NONE', 'LEGACY');
ALTER TABLE "Pairing"
  ADD COLUMN "roomMode" "PairingRoomMode" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "roomNeedsAssignment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "roomVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "roomShortageKey" TEXT;
UPDATE "Pairing" SET "roomMode" = 'FIXED' WHERE "roomId" IS NOT NULL;

-- Older seeds/imports can still supply roomId without the new intent column. Such an
-- explicit reservation is fixed; only the allocator may deliberately write AUTO.
CREATE FUNCTION normalize_legacy_pairing_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."roomMode" = 'LEGACY' AND NEW."roomId" IS NOT NULL THEN NEW."roomMode" := 'FIXED'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pairing_room_legacy_intent BEFORE INSERT ON "Pairing"
FOR EACH ROW EXECUTE FUNCTION normalize_legacy_pairing_room();

-- Roster edits outside the pairing editor (withdrawal, discipline and identity workflows)
-- must invalidate that editor's snapshot as well. This does not allocate or alter rooms.
CREATE FUNCTION bump_pairing_roster_room_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."pairingId" IS NOT DISTINCT FROM OLD."pairingId"
     AND NEW."tuteeId" IS NOT DISTINCT FROM OLD."tuteeId" THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' THEN
    UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1 WHERE id = OLD."pairingId";
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."pairingId" IS DISTINCT FROM OLD."pairingId") THEN
    UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1 WHERE id = NEW."pairingId";
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER pairing_roster_room_version AFTER INSERT OR UPDATE OR DELETE ON "PairingTutee"
FOR EACH ROW EXECUTE FUNCTION bump_pairing_roster_room_version();

ALTER TABLE "Pairing" ADD CONSTRAINT pairing_room_intent_consistent CHECK (
  ("roomMode" <> 'NONE' OR "roomId" IS NULL)
  AND (NOT "roomNeedsAssignment" OR ("roomMode" = 'AUTO' AND "roomId" IS NULL AND "scheduleConfirmed"))
  AND ("roomNeedsAssignment" = ("roomShortageKey" IS NOT NULL))
);
