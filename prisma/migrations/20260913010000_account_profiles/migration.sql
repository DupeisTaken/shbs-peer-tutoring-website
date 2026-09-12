ALTER TABLE "User" ADD COLUMN "alternativeNames" TEXT,
  ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tutor" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Tutee" ADD COLUMN "alternativeNames" TEXT;

-- Preserve existing alternative names, and initialize only explicitly linked profiles.
-- Signatures, survey submissions, audit snapshots and unlinked records remain historical data.
UPDATE "User" u SET "alternativeNames" = t."alternativeNames",
  "name" = COALESCE(NULLIF(BTRIM(u."name"), ''), t."englishName")
FROM "Tutor" t WHERE u."tutorId" = t.id;
UPDATE "User" u SET "name" = t."englishName"
FROM "Tutee" t WHERE u."studentId" = t.id AND NULLIF(BTRIM(u."name"), '') IS NULL;
UPDATE "Tutor" t SET "englishName" = u."name",
  "firstName" = SPLIT_PART(u."name", ' ', 1),
  "lastName" = NULLIF(SUBSTRING(u."name" FROM POSITION(' ' IN u."name") + 1), u."name"),
  "alternativeNames" = u."alternativeNames"
FROM "User" u WHERE u."tutorId" = t.id AND u."name" IS NOT NULL;
UPDATE "Tutee" t SET "englishName" = u."name", "alternativeNames" = u."alternativeNames",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "User" u WHERE u."studentId" = t.id AND u."name" IS NOT NULL;
