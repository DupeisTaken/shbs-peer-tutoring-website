BEGIN;

ALTER TABLE "User" ADD COLUMN "historyAccessRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PersonCombineReceipt" ADD COLUMN "ownershipTransfers" JSONB NOT NULL DEFAULT '[]'::JSONB;
CREATE OR REPLACE FUNCTION advance_account_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."historyAccessRevision"<OLD."historyAccessRevision" THEN
  RAISE EXCEPTION 'History access revisions cannot move backwards' USING ERRCODE='23514';
 END IF;
 IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash"
    OR OLD."recoveryVoidedAt" IS DISTINCT FROM NEW."recoveryVoidedAt"
    OR OLD."historyAccessRevision" IS DISTINCT FROM NEW."historyAccessRevision" THEN
   NEW."sessionVersion" := OLD."sessionVersion" + 1;
 ELSE NEW."sessionVersion" := OLD."sessionVersion";
 END IF;
 RETURN NEW;
END $$;

CREATE TABLE "RetiredHistoryOwnership" (
 "sourceUserId" TEXT PRIMARY KEY, "readerUserId" TEXT, state TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, "receiptId" TEXT,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT history_assignment_state CHECK ((state='ASSIGNED' AND "readerUserId" IS NOT NULL) OR (state='QUARANTINED' AND "readerUserId" IS NULL))
);
CREATE INDEX "RetiredHistoryOwnership_readerUserId_idx" ON "RetiredHistoryOwnership"("readerUserId");
CREATE TABLE "HistoryRowOwnership" (
 entity TEXT NOT NULL, "recordId" TEXT NOT NULL, "readerUserId" TEXT, "quarantineUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "sourceUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 revision INTEGER NOT NULL DEFAULT 1, "receiptId" TEXT NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entity,"recordId"),
 CONSTRAINT history_row_entity CHECK (entity IN ('Notification','EmailDelivery','StudentQuarterBlock','Tutor','Tutee'))
);
CREATE INDEX "HistoryRowOwnership_readerUserId_entity_idx" ON "HistoryRowOwnership"("readerUserId",entity);
CREATE TABLE "PersonHistoryCorrectionReceipt" (
 id TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
 "personId" TEXT NOT NULL, "destinationPersonId" TEXT NOT NULL,
 "sourceUserIds" TEXT[] NOT NULL, before JSONB NOT NULL, after JSONB NOT NULL,
 subjects JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER person_history_correction_receipt_immutable BEFORE UPDATE OR DELETE ON "PersonHistoryCorrectionReceipt"
 FOR EACH ROW EXECUTE FUNCTION person_partition_receipt_immutable();

-- Backfill each original independently. Cycles, missing terminals and voided
-- terminals are explicit quarantine; no future reader may infer a fallback.
WITH RECURSIVE chain AS (
 SELECT id AS source, id, "mergedIntoId", ARRAY[id] AS visited, false AS cycle
 FROM "User" WHERE "mergedIntoId" IS NOT NULL
 UNION ALL
 SELECT c.source,u.id,u."mergedIntoId",c.visited||u.id,u.id=ANY(c.visited)
 FROM chain c JOIN "User" u ON u.id=c."mergedIntoId" WHERE NOT c.cycle
), terminal AS (
 SELECT c.source,c.id FROM chain c JOIN "User" u ON u.id=c.id
 WHERE c."mergedIntoId" IS NULL AND NOT c.cycle AND u."recoveryVoidedAt" IS NULL
)
INSERT INTO "RetiredHistoryOwnership"("sourceUserId","readerUserId",state)
 SELECT u.id,t.id,CASE WHEN t.id IS NULL THEN 'QUARANTINED' ELSE 'ASSIGNED' END
 FROM "User" u LEFT JOIN terminal t ON t.source=u.id WHERE u."mergedIntoId" IS NOT NULL;

CREATE FUNCTION enforce_history_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'History ownership requires an explicit versioned quarantine' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."sourceUserId" AND "mergedIntoId" IS NOT NULL) THEN
   RAISE EXCEPTION 'History source must be a retired original account' USING ERRCODE='23514';
 END IF;
 IF NEW."readerUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."readerUserId" AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL) THEN
   RAISE EXCEPTION 'History recipient must be a live account' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."sourceUserId" IS DISTINCT FROM OLD."sourceUserId" THEN RAISE EXCEPTION 'Original history source is immutable' USING ERRCODE='23514'; END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_history_assignment BEFORE INSERT OR UPDATE OR DELETE ON "RetiredHistoryOwnership"
 FOR EACH ROW EXECUTE FUNCTION enforce_history_assignment();

-- Every retirement writer, including imports, initializes all explicit effective
-- ownership in the same transaction. Correcting A's own history later cannot move B.
CREATE FUNCTION initialize_retired_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient TEXT;
BEGIN
 IF NEW."mergedIntoId" IS NULL OR (TG_OP='UPDATE' AND OLD."mergedIntoId" IS NOT NULL) THEN RETURN NEW; END IF;
 SELECT id INTO recipient FROM "User" WHERE id=NEW."mergedIntoId" AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL;
 IF recipient IS NULL THEN RAISE EXCEPTION 'New retirement requires a live recipient' USING ERRCODE='23514'; END IF;
 INSERT INTO "RetiredHistoryOwnership"("sourceUserId","readerUserId",state) VALUES(NEW.id,recipient,'ASSIGNED');
 UPDATE "RetiredHistoryOwnership" SET "readerUserId"=recipient,"updatedAt"=CURRENT_TIMESTAMP
 WHERE "readerUserId"=NEW.id;
 UPDATE "HistoryRowOwnership" SET "readerUserId"=recipient,revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP
 WHERE "readerUserId"=NEW.id;
 UPDATE "HistoryRowOwnership" SET "quarantineUserIds"=array_replace("quarantineUserIds",NEW.id,recipient),revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP
 WHERE NEW.id=ANY("quarantineUserIds");
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_retired_history AFTER INSERT OR UPDATE ON "User"
 FOR EACH ROW EXECUTE FUNCTION initialize_retired_history();

CREATE FUNCTION revoke_changed_history_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_reader TEXT; next_reader TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN previous_reader:=OLD."readerUserId"; END IF;
 IF TG_OP<>'DELETE' THEN next_reader:=NEW."readerUserId"; END IF;
 UPDATE "User" SET "historyAccessRevision"="historyAccessRevision"+1
 WHERE id IN (previous_reader,next_reader) AND "mergedIntoId" IS NULL;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER revoke_changed_history_sessions AFTER INSERT OR UPDATE OR DELETE ON "RetiredHistoryOwnership"
 FOR EACH ROW EXECUTE FUNCTION revoke_changed_history_sessions();
CREATE TRIGGER revoke_changed_history_sessions AFTER INSERT OR UPDATE OR DELETE ON "HistoryRowOwnership"
 FOR EACH ROW EXECUTE FUNCTION revoke_changed_history_sessions();

CREATE FUNCTION enforce_history_row_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exact row ownership requires a versioned replacement' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.entity IS DISTINCT FROM OLD.entity OR NEW."recordId" IS DISTINCT FROM OLD."recordId" THEN RAISE EXCEPTION 'Original history row identity is immutable' USING ERRCODE='23514'; END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW."readerUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."readerUserId" AND "mergedIntoId" IS NULL AND "recoveryVoidedAt" IS NULL) THEN
  RAISE EXCEPTION 'History recipient must be a live account' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_history_row_revision BEFORE INSERT OR UPDATE OR DELETE ON "HistoryRowOwnership"
 FOR EACH ROW EXECUTE FUNCTION enforce_history_row_revision();

CREATE FUNCTION enforce_reviewed_profile_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_kind TEXT; source_id TEXT; authority RECORD;
BEGIN
 source_kind:=CASE WHEN TG_TABLE_NAME='TutorProfileOwnership' THEN 'Tutor' ELSE 'Tutee' END;
 source_id:=CASE WHEN TG_TABLE_NAME='TutorProfileOwnership' THEN to_jsonb(NEW)->>'tutorId' ELSE to_jsonb(NEW)->>'tuteeId' END;
 SELECT * INTO authority FROM "HistoryRowOwnership" WHERE entity=source_kind AND "recordId"=source_id;
 IF FOUND AND authority."readerUserId" IS DISTINCT FROM NEW."userId" THEN
  RAISE EXCEPTION 'Reviewed historical ownership requires exact correction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_reviewed_profile_owner BEFORE INSERT OR UPDATE ON "TutorProfileOwnership"
 FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_profile_owner();
CREATE TRIGGER enforce_reviewed_profile_owner BEFORE INSERT OR UPDATE ON "StudentProfileOwnership"
 FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_profile_owner();

-- Direct pointer provisioning must respect the same exact quarantine as retained
-- ownership, including writers which have not reached directory synchronization.
CREATE FUNCTION enforce_reviewed_current_profile_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."tutorId" IS NOT NULL AND EXISTS(SELECT 1 FROM "HistoryRowOwnership" WHERE entity='Tutor' AND "recordId"=NEW."tutorId" AND "readerUserId" IS DISTINCT FROM NEW.id) THEN
  RAISE EXCEPTION 'Reviewed tutor ownership requires exact correction' USING ERRCODE='23514';
 END IF;
 IF NEW."studentId" IS NOT NULL AND EXISTS(SELECT 1 FROM "HistoryRowOwnership" WHERE entity='Tutee' AND "recordId"=NEW."studentId" AND "readerUserId" IS DISTINCT FROM NEW.id) THEN
  RAISE EXCEPTION 'Reviewed student ownership requires exact correction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_reviewed_current_profile_owner BEFORE INSERT OR UPDATE ON "User"
 FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_current_profile_owner();

COMMIT;
