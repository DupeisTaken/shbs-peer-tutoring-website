-- A membership edit invalidates the same sibling editors as before. Lock
-- the complete affected set before journaling the increments, then visit it
-- in primary-key order independently of the planner's chosen access path.
CREATE OR REPLACE FUNCTION public.bump_group_membership_room_versions()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_group text;
  excluded_id text;
  siblings text[];
  sibling text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."groupId" IS NOT DISTINCT FROM OLD."groupId" THEN RETURN NULL; END IF;
    new_group := NEW."groupId";
    excluded_id := NEW.id;
  END IF;

  SELECT ARRAY(
    SELECT p.id FROM public."Pairing" AS p
    WHERE (excluded_id IS NULL OR p.id <> excluded_id)
      AND (p."groupId" = OLD."groupId" OR p."groupId" = new_group)
    ORDER BY p.id COLLATE "C"
    FOR UPDATE
  ) INTO siblings;

  FOREACH sibling IN ARRAY siblings LOOP
    UPDATE public."Pairing" SET "roomVersion" = "roomVersion" + 1 WHERE id = sibling;
  END LOOP;
  RETURN NULL;
END;
$$;
