-- Languages can be translated privately before they are published in the public picker.
ALTER TABLE "Language" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false;

-- English is the guaranteed fallback; Chinese is the other polished default catalog.
UPDATE "Language"
SET "enabled" = true
WHERE "code" IN ('en', 'zh');
