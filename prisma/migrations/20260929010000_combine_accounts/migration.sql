ALTER TABLE "User" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "User_mergedIntoId_idx" ON "User"("mergedIntoId");
ALTER TABLE "User" ADD CONSTRAINT "User_merge_not_self" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> id);

-- Retired identity rows are permanent historical evidence, never dormant reusable logins.
-- Keep the survivor and duplicate undeletable so merge ownership cannot dangle.
CREATE FUNCTION protect_combined_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."mergedIntoId" IS NOT NULL OR EXISTS (SELECT 1 FROM "User" WHERE "mergedIntoId" = OLD.id) THEN
      RAISE EXCEPTION 'Combined account history must be retained' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."mergedIntoId" IS NOT NULL AND (
    NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" OR
    NEW."passwordHash" IS NOT NULL OR NEW."tutorId" IS NOT NULL OR NEW."studentId" IS NOT NULL OR
    NEW.role IS DISTINCT FROM OLD.role OR NEW.email IS DISTINCT FROM OLD.email OR
    NEW.username IS DISTINCT FROM OLD.username
  ) THEN
    RAISE EXCEPTION 'Retired login cannot be restored or reassigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER combined_account_guard BEFORE UPDATE OR DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_combined_account();
