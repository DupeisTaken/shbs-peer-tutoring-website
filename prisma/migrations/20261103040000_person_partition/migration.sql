BEGIN;

CREATE TABLE "PersonPartitionReceipt" (
  "id" TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "newPersonId" TEXT NOT NULL,
  "sources" JSONB NOT NULL,
  "subjects" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A correction is permanent audit evidence, not an instruction to resurrect a
-- login or reverse later authorized ownership decisions.
CREATE FUNCTION person_partition_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Identity separation receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER person_partition_receipt_immutable BEFORE UPDATE OR DELETE ON "PersonPartitionReceipt"
  FOR EACH ROW EXECUTE FUNCTION person_partition_receipt_immutable();

-- Only typed affected subjects join a causal root. The reviewer may manage many
-- unrelated people: actorId, input hashes and free-text reasons are not edges.
CREATE FUNCTION recovery_capture_person_partition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_id TEXT; event_id TEXT; safe_receipt JSONB; safe_subjects JSONB;
  compensating_root TEXT := NULLIF(current_setting('shbs.recovery_compensating',true),'');
BEGIN
  IF compensating_root='1' THEN RAISE EXCEPTION 'Recovery compensation requires an exact root'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('entity',subject.entity,'recordId',subject."recordId")),'[]'::jsonb)
    INTO safe_subjects FROM jsonb_to_recordset(NEW.subjects) AS subject(entity TEXT,"recordId" TEXT)
    WHERE subject.entity IN ('Person','User','Tutor','Tutee') AND subject."recordId" IS NOT NULL;
  safe_receipt := jsonb_build_object('id',NEW.id,'personId',NEW."personId",
    'newPersonId',NEW."newPersonId",'subjects',safe_subjects);
  FOR root_id IN
    SELECT DISTINCT tracked."actionId" FROM "RecoveryTrackedEntity" tracked
    JOIN jsonb_to_recordset(safe_subjects) AS subject(entity TEXT,"recordId" TEXT)
      ON tracked.entity=subject.entity AND tracked."recordId"=subject."recordId"
    ORDER BY tracked."actionId"
  LOOP
    IF root_id=compensating_root THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
    IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN CONTINUE; END IF;
    INSERT INTO "RecoveryFence"("actionId","revision") VALUES(root_id,1)
      ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
    event_id := md5(root_id || ':' || txid_current()::text);
    INSERT INTO "RecoveryEvent"("id","actionId","transactionId","kind")
      VALUES(event_id,root_id,txid_current()::text,CASE WHEN compensating_root IS NOT NULL THEN 'RECOVERY_COMPENSATION' ELSE 'UNSUPPORTED' END)
      ON CONFLICT ("actionId","transactionId") DO NOTHING;
    INSERT INTO "RecoveryChange"("actionId","eventId","entity","operation","recordKey","before","after","changedFields")
      VALUES(root_id,event_id,'PersonPartitionReceipt','INSERT',jsonb_build_object('id',NEW.id),NULL,safe_receipt,
        (SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(to_jsonb(NEW)) AS field(key)));
    INSERT INTO "RecoveryTrackedEntity"("actionId","entity","recordId")
      VALUES(root_id,'PersonPartitionReceipt',NEW.id) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

-- Coverage validates this exact specialized function; correction remains an
-- unsupported descendant, not an implicit authorization to reverse identity.
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "PersonPartitionReceipt"
  FOR EACH ROW EXECUTE FUNCTION recovery_capture_person_partition();

COMMIT;
