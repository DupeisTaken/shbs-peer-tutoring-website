-- Current-role field requirements are independent from display preferences and original values.
ALTER TABLE "ProgramSettings" ADD COLUMN "nameFields" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "nameFieldsVersion" INTEGER NOT NULL DEFAULT 0;

-- Keep the five-argument historical formatter available; live triggers use this role-aware overload.
CREATE FUNCTION program_person_name(first_name TEXT, last_name TEXT, preferred_name TEXT,
  alternate_name TEXT, legacy_name TEXT, account_role TEXT, fallback_username TEXT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE settings JSONB; use_preferred BOOLEAN; show_alternate BOOLEAN; primary_name TEXT; alternate TEXT;
  is_legacy BOOLEAN := first_name IS NULL AND last_name IS NULL AND preferred_name IS NULL;
BEGIN
  SELECT "nameFields"->account_role, "usePreferredNames", "showAlternateNames"
    INTO settings, use_preferred, show_alternate FROM "ProgramSettings" WHERE id='program';
  IF settings->>'firstName' = 'hidden' THEN first_name := NULL; END IF;
  IF settings->>'lastName' = 'hidden' THEN last_name := NULL; END IF;
  IF settings->>'preferredName' = 'hidden' THEN preferred_name := NULL; END IF;
  IF settings->>'alternativeNames' = 'hidden' THEN alternate_name := NULL; END IF;
  -- An unsplit legacy label cannot be safely separated into hidden versus visible parts.
  IF settings->>'firstName' = 'hidden' OR settings->>'lastName' = 'hidden'
    OR settings->>'preferredName' = 'hidden' THEN legacy_name := NULL; END IF;
  primary_name := NULLIF(concat_ws(' ',
    CASE WHEN COALESCE(use_preferred,true) THEN COALESCE(NULLIF(btrim(preferred_name),''),NULLIF(btrim(first_name),''))
      ELSE NULLIF(btrim(first_name),'') END, NULLIF(btrim(last_name),'')), '');
  IF is_legacy THEN primary_name := COALESCE(primary_name, NULLIF(btrim(legacy_name),'')); END IF;
  alternate := CASE WHEN COALESCE(show_alternate,false) THEN NULLIF(btrim(alternate_name),'') ELSE NULL END;
  RETURN COALESCE(NULLIF(concat_ws(' · ',primary_name,alternate),''),NULLIF(fallback_username,''),'');
END $$;

CREATE OR REPLACE FUNCTION refresh_person_name() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE input_label TEXT; old_label TEXT; account_role TEXT; handle TEXT; explicit_first TEXT; explicit_last TEXT; explicit_preferred TEXT;
BEGIN
  IF TG_TABLE_NAME='User' THEN input_label:=NEW.name; account_role:=NEW.role::text; handle:=NEW.username;
  ELSE
    input_label:=NEW."englishName";
    IF TG_TABLE_NAME='Tutor' THEN
      SELECT role::text, username INTO account_role,handle FROM "User" WHERE "tutorId"=NEW.id;
      account_role:=COALESCE(account_role,'TUTOR'); handle:=COALESCE(handle,NEW.username);
    ELSE
      SELECT role::text,username INTO account_role,handle FROM "User" WHERE "studentId"=NEW.id;
      account_role:=COALESCE(account_role,'STUDENT');
    END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    -- A generated handle is a display fallback, never an original human name.
    IF input_label IS DISTINCT FROM handle THEN NEW."legacyName":=COALESCE(NEW."legacyName",NULLIF(input_label,'')); END IF;
  ELSE
    IF TG_TABLE_NAME='User' THEN old_label:=OLD.name; ELSE old_label:=OLD."englishName"; END IF;
    IF NEW."firstName" IS NULL AND input_label IS DISTINCT FROM old_label
      AND input_label IS DISTINCT FROM handle THEN NEW."legacyName":=input_label; END IF;
  END IF;
  explicit_first:=NEW."firstName"; explicit_last:=NEW."lastName"; explicit_preferred:=NEW."preferredName";
  IF TG_TABLE_NAME='Tutor' THEN
    IF TG_OP='UPDATE' AND (NEW."firstName" IS DISTINCT FROM OLD."firstName" OR NEW."lastName" IS DISTINCT FROM OLD."lastName"
      OR NEW."preferredName" IS DISTINCT FROM OLD."preferredName") THEN NEW."nameFieldsConfirmed":=true; END IF;
    IF NOT NEW."nameFieldsConfirmed" THEN explicit_first:=NULL; explicit_last:=NULL; explicit_preferred:=NULL; END IF;
  END IF;
  input_label:=program_person_name(explicit_first,explicit_last,explicit_preferred,NEW."alternativeNames",NEW."legacyName",account_role,handle);
  IF TG_TABLE_NAME='User' THEN NEW.name:=NULLIF(input_label,''); ELSE NEW."englishName":=input_label; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER user_person_name ON "User";
CREATE TRIGGER user_person_name BEFORE INSERT OR UPDATE OF name,"firstName","lastName","preferredName","alternativeNames","legacyName",username,role ON "User" FOR EACH ROW EXECUTE FUNCTION refresh_person_name();
DROP TRIGGER tutor_person_name ON "Tutor";
CREATE TRIGGER tutor_person_name BEFORE INSERT OR UPDATE OF "englishName","firstName","lastName","preferredName","alternativeNames","legacyName",username ON "Tutor" FOR EACH ROW EXECUTE FUNCTION refresh_person_name();

CREATE FUNCTION refresh_name_field_policy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "User" SET "preferredName"="preferredName";
  UPDATE "Tutor" SET "preferredName"="preferredName";
  UPDATE "Tutee" SET "preferredName"="preferredName";
  RETURN NEW;
END $$;
CREATE TRIGGER program_name_field_policy AFTER UPDATE OF "nameFields" ON "ProgramSettings"
  FOR EACH ROW WHEN (OLD."nameFields" IS DISTINCT FROM NEW."nameFields") EXECUTE FUNCTION refresh_name_field_policy();
CREATE FUNCTION refresh_linked_name_labels() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Tutor" SET "preferredName"="preferredName" WHERE id=NEW."tutorId";
  UPDATE "Tutee" SET "preferredName"="preferredName" WHERE id=NEW."studentId";
  RETURN NEW;
END $$;
CREATE TRIGGER account_name_role AFTER INSERT OR UPDATE OF role,username,"studentId","tutorId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION refresh_linked_name_labels();

