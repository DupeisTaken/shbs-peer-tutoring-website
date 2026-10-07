CREATE TABLE "TutorProfileOwnership" (
  "tutorId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TutorProfileOwnership_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "TutorProfileOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "TutorProfileOwnership_userId_idx" ON "TutorProfileOwnership"("userId");

-- Current login linking (including signup) cannot give a second person access to
-- an explicitly owned archive. Both writers serialize on the original Tutor row.
CREATE FUNCTION protect_retained_tutor_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tutorId" IS NOT NULL THEN
    PERFORM id FROM "Tutor" WHERE id = NEW."tutorId" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "TutorProfileOwnership" WHERE "tutorId" = NEW."tutorId" AND "userId" <> NEW.id) THEN
      RAISE EXCEPTION 'Historical tutor belongs to another account; staff ownership review required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retained_tutor_login_guard BEFORE INSERT OR UPDATE OF "tutorId" ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_retained_tutor_owner();

CREATE FUNCTION protect_current_tutor_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Tutor" WHERE id = NEW."tutorId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "User" WHERE "tutorId" = NEW."tutorId" AND id <> NEW."userId") THEN
    RAISE EXCEPTION 'Tutor has another current login; use account combination' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retained_tutor_owner_guard BEFORE INSERT OR UPDATE ON "TutorProfileOwnership"
FOR EACH ROW EXECUTE FUNCTION protect_current_tutor_owner();
