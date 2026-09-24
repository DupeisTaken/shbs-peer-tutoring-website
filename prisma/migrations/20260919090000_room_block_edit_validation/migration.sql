-- Extend the existing room guard without rewriting historical blocks. New or
-- edited rows must be valid and disjoint; adjacent half-open periods are legal.
-- Keep the room advisory lock shared with the pairing trigger.
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
    WHERE t.active AND p."roomId" = NEW."roomId"
      AND p."dayOfWeek" = NEW."dayOfWeek"
      AND p."startMin" < NEW."endMin" AND p."endMin" > NEW."startMin"
  ) THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
