-- Explicit teaching groups share allocation state. Invalidate every member editor
-- after a roster/member change without allocating, rewriting attendance or backfilling.
CREATE OR REPLACE FUNCTION bump_pairing_roster_room_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_group TEXT; new_group TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."pairingId" IS NOT DISTINCT FROM OLD."pairingId"
    AND NEW."tuteeId" IS NOT DISTINCT FROM OLD."tuteeId" THEN RETURN NULL; END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT "groupId" INTO old_group FROM "Pairing" WHERE id = OLD."pairingId";
    UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1
      WHERE id = OLD."pairingId" OR (old_group IS NOT NULL AND "groupId" = old_group);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."pairingId" IS DISTINCT FROM OLD."pairingId") THEN
    SELECT "groupId" INTO new_group FROM "Pairing" WHERE id = NEW."pairingId";
    UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1
      WHERE id = NEW."pairingId" OR (new_group IS NOT NULL AND "groupId" = new_group);
  END IF;
  RETURN NULL;
END; $$;

-- The ownership trigger can detach an independently edited member. Sibling room
-- editors must observe that membership change even when their own row was untouched.
CREATE FUNCTION bump_group_membership_room_versions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1 WHERE "groupId" = OLD."groupId";
    RETURN NULL;
  END IF;
  IF NEW."groupId" IS NOT DISTINCT FROM OLD."groupId" THEN RETURN NULL; END IF;
  UPDATE "Pairing" SET "roomVersion" = "roomVersion" + 1
    WHERE id <> NEW.id AND ("groupId" = OLD."groupId" OR "groupId" = NEW."groupId");
  RETURN NULL;
END; $$;
CREATE TRIGGER pairing_group_room_versions AFTER UPDATE OF "groupId" ON "Pairing"
FOR EACH ROW EXECUTE FUNCTION bump_group_membership_room_versions();
CREATE TRIGGER pairing_group_deleted_room_versions AFTER DELETE ON "Pairing"
FOR EACH ROW EXECUTE FUNCTION bump_group_membership_room_versions();
