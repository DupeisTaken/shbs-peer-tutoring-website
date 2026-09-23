-- Historical copied times have unknown provenance: preserve them, including detached slots.
ALTER TABLE "Pairing" ADD COLUMN "scheduleConfirmed" BOOLEAN NOT NULL DEFAULT true;
-- New assignments must explicitly confirm a real schedule before these times are displayed.
ALTER TABLE "Pairing" ALTER COLUMN "scheduleConfirmed" SET DEFAULT false;

-- Unscheduled numeric placeholders do not reserve rooms. Confirmation rechecks every guard.
CREATE OR REPLACE FUNCTION enforce_pairing_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW."scheduleConfirmed" OR NEW."roomId" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-room:' || NEW."roomId", 0));
  IF EXISTS (SELECT 1 FROM "Pairing" p WHERE p.id <> NEW.id AND p."scheduleConfirmed" AND p."roomId" = NEW."roomId" AND p."termId" = NEW."termId" AND p."dayOfWeek" = NEW."dayOfWeek" AND p."startMin" < NEW."endMin" AND p."endMin" > NEW."startMin")
     OR EXISTS (SELECT 1 FROM "RoomUnavailability" b WHERE b."roomId" = NEW."roomId" AND b."dayOfWeek" = NEW."dayOfWeek" AND b."startMin" < NEW."endMin" AND b."endMin" > NEW."startMin") THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER pairing_room_guard ON "Pairing";
CREATE TRIGGER pairing_room_guard BEFORE INSERT OR UPDATE OF "scheduleConfirmed", "roomId", "termId", "dayOfWeek", "startMin", "endMin" ON "Pairing" FOR EACH ROW EXECUTE FUNCTION enforce_pairing_room();

CREATE OR REPLACE FUNCTION enforce_room_unavailability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."dayOfWeek" NOT BETWEEN 1 AND 7
     OR NEW."startMin" < 0 OR NEW."endMin" > 1440
     OR NEW."endMin" <= NEW."startMin" THEN
    RAISE EXCEPTION 'Invalid room blocked period' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-room:' || NEW."roomId", 0));
  IF EXISTS (
    SELECT 1 FROM "RoomUnavailability" b
    WHERE b.id <> NEW.id AND b."roomId" = NEW."roomId"
      AND b."dayOfWeek" = NEW."dayOfWeek"
      AND b."startMin" < NEW."endMin" AND b."endMin" > NEW."startMin"
  ) THEN
    RAISE EXCEPTION 'Room blocked periods overlap' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Pairing" p JOIN "Term" t ON t.id = p."termId"
    WHERE t.active AND p."scheduleConfirmed" AND p."roomId" = NEW."roomId"
      AND p."dayOfWeek" = NEW."dayOfWeek"
      AND p."startMin" < NEW."endMin" AND p."endMin" > NEW."startMin"
  ) THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
