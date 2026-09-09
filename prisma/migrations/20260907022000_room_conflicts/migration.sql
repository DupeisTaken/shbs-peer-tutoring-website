-- All writers (including slot edits and assignment pipelines) share the same room lock.
-- Half-open intervals allow a booking to start exactly when another ends.
CREATE FUNCTION enforce_pairing_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."roomId" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-room:' || NEW."roomId", 0));
  IF EXISTS (SELECT 1 FROM "Pairing" p WHERE p.id <> NEW.id AND p."roomId" = NEW."roomId" AND p."termId" = NEW."termId" AND p."dayOfWeek" = NEW."dayOfWeek" AND p."startMin" < NEW."endMin" AND p."endMin" > NEW."startMin")
     OR EXISTS (SELECT 1 FROM "RoomUnavailability" b WHERE b."roomId" = NEW."roomId" AND b."dayOfWeek" = NEW."dayOfWeek" AND b."startMin" < NEW."endMin" AND b."endMin" > NEW."startMin") THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pairing_room_guard BEFORE INSERT OR UPDATE OF "roomId", "termId", "dayOfWeek", "startMin", "endMin" ON "Pairing" FOR EACH ROW EXECUTE FUNCTION enforce_pairing_room();

CREATE FUNCTION enforce_room_unavailability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-room:' || NEW."roomId", 0));
  IF EXISTS (SELECT 1 FROM "Pairing" p JOIN "Term" t ON t.id=p."termId" WHERE t.active AND p."roomId"=NEW."roomId" AND p."dayOfWeek"=NEW."dayOfWeek" AND p."startMin"<NEW."endMin" AND p."endMin">NEW."startMin") THEN
    RAISE EXCEPTION 'Room already allocated at this time' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER room_unavailability_guard BEFORE INSERT OR UPDATE ON "RoomUnavailability" FOR EACH ROW EXECUTE FUNCTION enforce_room_unavailability();
