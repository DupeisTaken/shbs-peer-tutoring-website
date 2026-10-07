-- New settings default on. Audited display choices remain authoritative below.
ALTER TABLE "ProgramSettings" ALTER COLUMN "usePreferredNames" SET DEFAULT true;

-- Scalar readers must use the same default as the API before settings exist.
CREATE OR REPLACE FUNCTION program_person_name(first_name TEXT, last_name TEXT, preferred_name TEXT,
  alternate_name TEXT, legacy_name TEXT) RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE use_preferred BOOLEAN; show_alternate BOOLEAN; primary_name TEXT;
BEGIN
  SELECT "usePreferredNames", "showAlternateNames" INTO use_preferred, show_alternate
    FROM "ProgramSettings" WHERE id = 'program';
  IF NULLIF(btrim(first_name), '') IS NULL THEN
    primary_name := legacy_name;
  ELSE
    primary_name := concat_ws(' ',
      CASE WHEN COALESCE(use_preferred, true) THEN COALESCE(NULLIF(btrim(preferred_name), ''), btrim(first_name)) ELSE btrim(first_name) END,
      NULLIF(btrim(last_name), ''));
  END IF;
  RETURN concat_ws(' · ', NULLIF(primary_name, ''),
    CASE WHEN COALESCE(show_alternate, false) THEN NULLIF(btrim(alternate_name), '') ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION refresh_program_name_display() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Inserting an explicit false now changes the effective policy from its true
  -- fallback. Refresh on every first settings write, including both toggles off.
  IF TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND (NEW."usePreferredNames" IS DISTINCT FROM OLD."usePreferredNames"
    OR NEW."showAlternateNames" IS DISTINCT FROM OLD."showAlternateNames")) THEN
    UPDATE "User" SET "preferredName" = "preferredName";
    UPDATE "Tutor" SET "preferredName" = "preferredName";
    UPDATE "Tutee" SET "preferredName" = "preferredName";
  END IF;
  RETURN NEW;
END $$;

-- An older migration creates the singleton with the old off default, even on a
-- fresh install. Adopt the new default unless an administrator has saved the
-- display controls. Older audits of Latin/grade policy lack this field and do not
-- represent a preferred-name choice. Keep the independent alternate-name setting.
UPDATE "ProgramSettings" SET "usePreferredNames" = true
  WHERE id = 'program' AND NOT EXISTS (
    SELECT 1 FROM "AuditLog"
      WHERE operation = 'program.setProfilePolicy'
        AND details->'after' ? 'usePreferredNames'
  );

-- Programs without settings also change effective policy on upgrade.
-- Refresh their current labels through the existing identity triggers. Source
-- fields, versions, timestamps, and historical evidence remain unchanged.
UPDATE "User" SET "preferredName" = "preferredName"
  WHERE NOT EXISTS (SELECT 1 FROM "ProgramSettings" WHERE id = 'program');
UPDATE "Tutor" SET "preferredName" = "preferredName"
  WHERE NOT EXISTS (SELECT 1 FROM "ProgramSettings" WHERE id = 'program');
UPDATE "Tutee" SET "preferredName" = "preferredName"
  WHERE NOT EXISTS (SELECT 1 FROM "ProgramSettings" WHERE id = 'program');
