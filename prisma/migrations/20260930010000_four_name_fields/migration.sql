ALTER TABLE "User" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT,
  ADD COLUMN "preferredName" TEXT, ADD COLUMN "legacyName" TEXT;
ALTER TABLE "Tutor" ADD COLUMN "preferredName" TEXT, ADD COLUMN "legacyName" TEXT, ADD COLUMN "nameFieldsConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tutor" ALTER COLUMN "nameFieldsConfirmed" SET DEFAULT true;
ALTER TABLE "Tutee" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT,
  ADD COLUMN "preferredName" TEXT, ADD COLUMN "legacyName" TEXT;
ALTER TABLE "ProgramSettings" ADD COLUMN "usePreferredNames" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "showAlternateNames" BOOLEAN NOT NULL DEFAULT false;

-- Preserve original text. Only an already-explicit, matching tutor split can seed an account.
UPDATE "User" SET "legacyName" = "name";
UPDATE "Tutor" SET "legacyName" = "englishName", "nameFieldsConfirmed" =
  NULLIF(btrim("firstName"), '') IS NOT NULL AND btrim("englishName") = btrim(concat_ws(' ', "firstName", NULLIF("lastName", '')));
UPDATE "Tutee" SET "legacyName" = "englishName";
UPDATE "User" u SET "firstName" = t."firstName", "lastName" = t."lastName"
FROM "Tutor" t WHERE u."tutorId" = t.id AND NULLIF(btrim(t."firstName"), '') IS NOT NULL
  AND btrim(u.name) = btrim(concat_ws(' ', t."firstName", NULLIF(t."lastName", '')));
UPDATE "Tutee" t SET "firstName" = u."firstName", "lastName" = u."lastName"
FROM "User" u WHERE u."studentId" = t.id AND u."firstName" IS NOT NULL
  AND t."englishName" = u.name;

-- Existing scalar readers (rosters, messages, exports, sessions) receive the same current
-- display label. Explicit fields remain canonical; historical evidence tables have no trigger.
CREATE FUNCTION program_person_name(first_name TEXT, last_name TEXT, preferred_name TEXT,
  alternate_name TEXT, legacy_name TEXT) RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE use_preferred BOOLEAN; show_alternate BOOLEAN; primary_name TEXT;
BEGIN
  SELECT "usePreferredNames", "showAlternateNames" INTO use_preferred, show_alternate
    FROM "ProgramSettings" WHERE id = 'program';
  IF NULLIF(btrim(first_name), '') IS NULL THEN
    primary_name := legacy_name;
  ELSE
    primary_name := concat_ws(' ',
      CASE WHEN COALESCE(use_preferred, false) THEN COALESCE(NULLIF(btrim(preferred_name), ''), btrim(first_name)) ELSE btrim(first_name) END,
      NULLIF(btrim(last_name), ''));
  END IF;
  RETURN concat_ws(' · ', NULLIF(primary_name, ''),
    CASE WHEN COALESCE(show_alternate, false) THEN NULLIF(btrim(alternate_name), '') ELSE NULL END);
END $$;

CREATE FUNCTION refresh_person_name() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE input_label TEXT; old_label TEXT;
BEGIN
  IF TG_TABLE_NAME = 'User' THEN input_label := NEW.name;
  ELSE input_label := NEW."englishName"; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW."legacyName" := COALESCE(NEW."legacyName", input_label);
  ELSE
    IF TG_TABLE_NAME = 'User' THEN old_label := OLD.name;
    ELSE old_label := OLD."englishName"; END IF;
    -- Legacy writers can still preserve unstructured source names; they never split them.
    IF NEW."firstName" IS NULL AND input_label IS DISTINCT FROM old_label THEN
      NEW."legacyName" := input_label;
    END IF;
  END IF;
  -- Some old tutor splits were guessed. Preserve their original label until an
  -- explicit editor confirms the fields; a settings refresh never confirms them.
  IF TG_TABLE_NAME = 'Tutor' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW."firstName" IS DISTINCT FROM OLD."firstName" OR NEW."lastName" IS DISTINCT FROM OLD."lastName"
        OR NEW."preferredName" IS DISTINCT FROM OLD."preferredName" THEN NEW."nameFieldsConfirmed" := true; END IF;
    END IF;
    IF NOT NEW."nameFieldsConfirmed" THEN
      NEW."englishName" := program_person_name(NULL, NULL, NULL, NEW."alternativeNames", NEW."legacyName");
      RETURN NEW;
    END IF;
  END IF;
  input_label := program_person_name(NEW."firstName", NEW."lastName", NEW."preferredName", NEW."alternativeNames", NEW."legacyName");
  IF TG_TABLE_NAME = 'User' THEN NEW.name := NULLIF(input_label, '');
  ELSE NEW."englishName" := input_label; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_person_name BEFORE INSERT OR UPDATE OF name, "firstName", "lastName", "preferredName", "alternativeNames", "legacyName" ON "User" FOR EACH ROW EXECUTE FUNCTION refresh_person_name();
CREATE TRIGGER tutor_person_name BEFORE INSERT OR UPDATE OF "englishName", "firstName", "lastName", "preferredName", "alternativeNames", "legacyName" ON "Tutor" FOR EACH ROW EXECUTE FUNCTION refresh_person_name();
CREATE TRIGGER tutee_person_name BEFORE INSERT OR UPDATE OF "englishName", "firstName", "lastName", "preferredName", "alternativeNames", "legacyName" ON "Tutee" FOR EACH ROW EXECUTE FUNCTION refresh_person_name();

CREATE FUNCTION refresh_program_name_display() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW."usePreferredNames" OR NEW."showAlternateNames"))
    OR (TG_OP = 'UPDATE' AND (NEW."usePreferredNames" IS DISTINCT FROM OLD."usePreferredNames"
    OR NEW."showAlternateNames" IS DISTINCT FROM OLD."showAlternateNames")) THEN
    UPDATE "User" SET "preferredName" = "preferredName";
    UPDATE "Tutor" SET "preferredName" = "preferredName";
    UPDATE "Tutee" SET "preferredName" = "preferredName";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER program_name_display AFTER INSERT OR UPDATE OF "usePreferredNames", "showAlternateNames" ON "ProgramSettings" FOR EACH ROW EXECUTE FUNCTION refresh_program_name_display();

ALTER TABLE "ViewerSignup" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT, ADD COLUMN "preferredName" TEXT, ADD COLUMN "alternativeNames" TEXT;
ALTER TABLE "CrewApplication" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT, ADD COLUMN "preferredName" TEXT, ADD COLUMN "alternativeNames" TEXT;
ALTER TABLE "TutorApplication" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT, ADD COLUMN "preferredName" TEXT, ADD COLUMN "alternativeNames" TEXT;
