-- Keep existing name values and preferred-name policy intact.
ALTER TABLE "ProgramSettings" ADD COLUMN "requireLatinLegalNames" BOOLEAN NOT NULL DEFAULT false;
