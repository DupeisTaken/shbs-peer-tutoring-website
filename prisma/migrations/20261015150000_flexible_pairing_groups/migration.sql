CREATE TABLE "PairingGroup" (
  "id" TEXT NOT NULL,
  "tutorId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "primaryPairingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PairingGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PairingGroup_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PairingGroup_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "Pairing" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PairingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PairingGroup_tutorId_termId_idx" ON "PairingGroup"("tutorId", "termId");
CREATE INDEX "Pairing_groupId_idx" ON "Pairing"("groupId");

-- Reassignment cannot retain another tutor's private group. A group never crosses periods.
CREATE FUNCTION enforce_pairing_group_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."tutorId" <> OLD."tutorId" OR NEW."termId" <> OLD."termId") THEN
    NEW."groupId" := NULL;
  END IF;
  -- A manager's independent schedule/room edit releases that subject from the group.
  -- Whole-group writers detach first; catalog propagation retains the same slot ID
  -- and has already updated its authoritative day/time before updating members.
  IF TG_OP = 'UPDATE' AND OLD."groupId" IS NOT NULL AND NEW."groupId" = OLD."groupId"
    AND (NEW."roomId" IS DISTINCT FROM OLD."roomId" OR NEW."scheduleConfirmed" <> OLD."scheduleConfirmed"
      OR NEW."dayOfWeek" <> OLD."dayOfWeek" OR NEW."startMin" <> OLD."startMin" OR NEW."endMin" <> OLD."endMin"
      OR (NEW."timeSlotId" IS NOT NULL AND NEW."timeSlotId" IS DISTINCT FROM OLD."timeSlotId"))
    AND NOT (NEW."roomId" IS NOT DISTINCT FROM OLD."roomId" AND NEW."scheduleConfirmed" AND NEW."timeSlotId" IS NOT NULL
      AND NEW."timeSlotId" = OLD."timeSlotId" AND EXISTS (SELECT 1 FROM "TimeSlot" s WHERE s.id=NEW."timeSlotId"
      AND s."dayOfWeek"=NEW."dayOfWeek" AND s."startMin"=NEW."startMin" AND s."endMin"=NEW."endMin")) THEN
    NEW."groupId" := NULL;
  END IF;
  IF NEW."groupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PairingGroup" g WHERE g.id = NEW."groupId" AND g."tutorId" = NEW."tutorId" AND g."termId" = NEW."termId"
  ) THEN RAISE EXCEPTION 'Pairing group ownership mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pairing_group_owner BEFORE INSERT OR UPDATE OF "groupId", "tutorId", "termId", "roomId", "timeSlotId", "scheduleConfirmed", "dayOfWeek", "startMin", "endMin" ON "Pairing" FOR EACH ROW EXECUTE FUNCTION enforce_pairing_group_owner();

-- Subjects taught by the same tutor in one group share a room booking. Unrelated
-- groups, standalone pairings and room blackouts retain the existing hard guard.
CREATE OR REPLACE FUNCTION enforce_pairing_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW."scheduleConfirmed" OR NEW."roomId" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-room:' || NEW."roomId", 0));
  IF EXISTS (SELECT 1 FROM "Pairing" p WHERE p.id <> NEW.id AND p."scheduleConfirmed"
    AND p."roomId" = NEW."roomId" AND p."termId" = NEW."termId" AND p."dayOfWeek" = NEW."dayOfWeek"
    AND p."startMin" < NEW."endMin" AND p."endMin" > NEW."startMin"
    AND NOT (NEW."groupId" IS NOT NULL AND p."groupId" IS NOT NULL AND p."groupId" = NEW."groupId" AND p."tutorId" = NEW."tutorId"))
    OR EXISTS (SELECT 1 FROM "RoomUnavailability" b WHERE b."roomId" = NEW."roomId" AND b."dayOfWeek" = NEW."dayOfWeek" AND b."startMin" < NEW."endMin" AND b."endMin" > NEW."startMin") THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER pairing_room_guard ON "Pairing";
CREATE TRIGGER pairing_room_guard BEFORE INSERT OR UPDATE OF "groupId", "scheduleConfirmed", "roomId", "termId", "dayOfWeek", "startMin", "endMin" ON "Pairing" FOR EACH ROW EXECUTE FUNCTION enforce_pairing_room();
