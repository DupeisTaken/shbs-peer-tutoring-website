-- Additive grants leave outstanding Tutee invitations and delivery attempts untouched.
ALTER TABLE "Tutor" ADD COLUMN "historyIdentityRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tutee" ADD COLUMN "historyIdentityRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "HistoricalRecordInvitation" (
  "scopeKey" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE,
  "sources" JSONB NOT NULL, "scopeFingerprint" TEXT NOT NULL, "email" TEXT NOT NULL,
  "recipientId" TEXT, "recipientSessionVersion" INTEGER, "recipientFingerprint" TEXT, "issuedById" TEXT NOT NULL, "issuedBySessionVersion" INTEGER NOT NULL,
  "reason" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "setupCodeHash" TEXT, "setupCodeExpiresAt" TIMESTAMP(3), "setupAttempts" INTEGER NOT NULL DEFAULT 0,
  "setupVerifiedAt" TIMESTAMP(3), "setupUserId" TEXT, "claimedAt" TIMESTAMP(3), "claimedUserId" TEXT
);
CREATE TABLE "HistoricalRecordInvitationAttempt" (
  "id" TEXT PRIMARY KEY, "sequence" SERIAL NOT NULL UNIQUE, "scopeKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "sources" JSONB NOT NULL,
  "scopeFingerprint" TEXT NOT NULL, "predecessorFingerprint" TEXT NOT NULL, "email" TEXT NOT NULL,
  "recipientId" TEXT, "recipientSessionVersion" INTEGER, "recipientFingerprint" TEXT, "issuedById" TEXT NOT NULL, "issuedBySessionVersion" INTEGER NOT NULL,
  "reason" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "TuteeHistoryInvitationAttemptStatus" NOT NULL DEFAULT 'ADMITTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "settledAt" TIMESTAMP(3)
);
CREATE INDEX "HistoricalRecordInvitationAttempt_scopeKey_sequence_idx" ON "HistoricalRecordInvitationAttempt"("scopeKey", "sequence");
CREATE UNIQUE INDEX "HistoricalRecordInvitationAttempt_one_admitted" ON "HistoricalRecordInvitationAttempt"("scopeKey") WHERE "status"='ADMITTED';
CREATE TABLE "HistoricalRecordClaimReceipt" (
  "tokenHash" TEXT PRIMARY KEY, "sources" JSONB NOT NULL, "userId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL, "email" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ownership A -> B -> A and delete/recreate must not revive a previously reviewed grant.
-- Only the separate fence changes: preserve original source timestamps/evidence.
CREATE FUNCTION history_source_group_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."personId" IS DISTINCT FROM OLD."personId" THEN
    NEW."historyIdentityRevision" := OLD."historyIdentityRevision" + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER history_tutor_group_revision BEFORE UPDATE ON "Tutor" FOR EACH ROW EXECUTE FUNCTION history_source_group_revision();
CREATE TRIGGER history_tutee_group_revision BEFORE UPDATE ON "Tutee" FOR EACH ROW EXECUTE FUNCTION history_source_group_revision();
CREATE FUNCTION history_retained_owner_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id TEXT;
BEGIN
  IF TG_TABLE_NAME='TutorProfileOwnership' THEN
    IF TG_OP <> 'DELETE' THEN source_id := NEW."tutorId"; ELSE source_id := OLD."tutorId"; END IF;
    UPDATE "Tutor" SET "historyIdentityRevision"="historyIdentityRevision"+1 WHERE id=source_id;
  ELSE
    IF TG_OP <> 'DELETE' THEN source_id := NEW."tuteeId"; ELSE source_id := OLD."tuteeId"; END IF;
    UPDATE "Tutee" SET "historyIdentityRevision"="historyIdentityRevision"+1 WHERE id=source_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_tutor_owner_revision AFTER INSERT OR UPDATE OR DELETE ON "TutorProfileOwnership" FOR EACH ROW EXECUTE FUNCTION history_retained_owner_revision();
CREATE TRIGGER history_tutee_owner_revision AFTER INSERT OR UPDATE OR DELETE ON "StudentProfileOwnership" FOR EACH ROW EXECUTE FUNCTION history_retained_owner_revision();
CREATE FUNCTION history_current_owner_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_tutor TEXT; new_tutor TEXT; old_tutee TEXT; new_tutee TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_tutor := OLD."tutorId"; old_tutee := OLD."studentId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_tutor := NEW."tutorId"; new_tutee := NEW."studentId"; END IF;
  IF new_tutor IS DISTINCT FROM old_tutor THEN
    UPDATE "Tutor" SET "historyIdentityRevision"="historyIdentityRevision"+1 WHERE id IN (old_tutor,new_tutor);
  END IF;
  IF new_tutee IS DISTINCT FROM old_tutee THEN
    UPDATE "Tutee" SET "historyIdentityRevision"="historyIdentityRevision"+1 WHERE id IN (old_tutee,new_tutee);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_current_owner_revision AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION history_current_owner_revision();

-- A sibling can join and leave while the selected source is unchanged. Advance
-- both groups on every membership edge so that remove-and-restore is also stale.
CREATE FUNCTION history_person_membership_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_person TEXT; new_person TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_person := OLD."personId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_person := NEW."personId"; END IF;
  IF old_person IS DISTINCT FROM new_person THEN
    UPDATE "Person" SET revision=revision+1 WHERE id IN (old_person,new_person);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_tutor_membership_revision AFTER INSERT OR UPDATE OR DELETE ON "Tutor" FOR EACH ROW EXECUTE FUNCTION history_person_membership_revision();
CREATE TRIGGER history_tutee_membership_revision AFTER INSERT OR UPDATE OR DELETE ON "Tutee" FOR EACH ROW EXECUTE FUNCTION history_person_membership_revision();
CREATE TRIGGER history_user_membership_revision AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION history_person_membership_revision();
