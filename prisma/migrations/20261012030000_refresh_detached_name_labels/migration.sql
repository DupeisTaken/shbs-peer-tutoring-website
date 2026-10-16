-- Relinking must refresh both identities: the old roster returns to its own
-- accountless policy and the new roster adopts the account's current role.
CREATE OR REPLACE FUNCTION refresh_linked_name_labels() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' OR OLD."tutorId" IS DISTINCT FROM NEW."tutorId" THEN
      UPDATE "Tutor" SET "preferredName"="preferredName" WHERE id=OLD."tutorId";
    END IF;
    IF TG_OP = 'DELETE' OR OLD."studentId" IS DISTINCT FROM NEW."studentId" THEN
      UPDATE "Tutee" SET "preferredName"="preferredName" WHERE id=OLD."studentId";
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE "Tutor" SET "preferredName"="preferredName" WHERE id=NEW."tutorId";
    UPDATE "Tutee" SET "preferredName"="preferredName" WHERE id=NEW."studentId";
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER account_deleted_name_role AFTER DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION refresh_linked_name_labels();
