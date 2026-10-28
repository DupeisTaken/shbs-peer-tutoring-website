ALTER TABLE "User" ADD COLUMN "recoveryVoidedAt" TIMESTAMP(3);
CREATE TABLE "RecoveryAction" ("id" TEXT PRIMARY KEY,"kind" TEXT NOT NULL,"applicationId" TEXT NOT NULL,"before" JSONB NOT NULL,"after" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "RecoveryAction_applicationId_createdAt_idx" ON "RecoveryAction"("applicationId","createdAt");
CREATE TABLE "RecoveryEvent" ("id" TEXT PRIMARY KEY,"actionId" TEXT NOT NULL,"transactionId" TEXT NOT NULL,"kind" TEXT NOT NULL,"payload" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "RecoveryEvent_actionId_transactionId_key" ON "RecoveryEvent"("actionId","transactionId");
CREATE INDEX "RecoveryEvent_actionId_createdAt_idx" ON "RecoveryEvent"("actionId","createdAt");
CREATE TABLE "RecoveryTrackedEntity" ("actionId" TEXT NOT NULL,"entity" TEXT NOT NULL,"recordId" TEXT NOT NULL,PRIMARY KEY("actionId","entity","recordId"));
CREATE INDEX "RecoveryTrackedEntity_recordId_idx" ON "RecoveryTrackedEntity"("recordId");
CREATE TABLE "RecoveryFence" ("actionId" TEXT PRIMARY KEY,"revision" INTEGER NOT NULL DEFAULT 0);
CREATE TABLE "RecoveryChange" ("id" BIGSERIAL PRIMARY KEY,"actionId" TEXT NOT NULL,"eventId" TEXT NOT NULL,"entity" TEXT NOT NULL,"operation" TEXT NOT NULL,"recordKey" JSONB NOT NULL,"before" JSONB,"after" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "RecoveryChange_actionId_id_idx" ON "RecoveryChange"("actionId","id");
CREATE INDEX "RecoveryChange_eventId_idx" ON "RecoveryChange"("eventId");
CREATE TABLE "RecoveryReceipt" ("id" TEXT PRIMARY KEY,"actionId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"clientKey" UUID NOT NULL,"inputHash" TEXT NOT NULL,"reason" TEXT NOT NULL,"channel" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"evidence" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "RecoveryReceipt_actionId_key" ON "RecoveryReceipt"("actionId");
CREATE UNIQUE INDEX "RecoveryReceipt_actorId_clientKey_key" ON "RecoveryReceipt"("actorId","clientKey");

-- Journal projections are a positive allowlist. Even future tables cannot leak a
-- password, token, verification challenge, invitation code or arbitrary JSON body.
CREATE FUNCTION recovery_safe_row(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) || CASE WHEN row_data->'source'->>'type'='staff' THEN jsonb_build_object('registrationCodeId',row_data->'source'->>'id') ELSE '{}'::jsonb END FROM jsonb_each(row_data)
 WHERE key = 'id' OR key LIKE '%Id' OR key IN ('status','state','role','tutorAccessRevoked','tuteeMember','crewStatus','canTranslate','sessionVersion','profileVersion','historyIdentityRevision','updatedAt','usedAt','expiresAt','firstAssignedAt','verificationDueAt','confirmedAt','recoveryVoidedAt','preferredAssignedBlocks','workloadPreferenceVersion','roomVersion','roomShortageKey','roomMode','roomNeedsAssignment','scheduleConfirmed','dayOfWeek','startMin','endMin','subject');
$$;

-- Every application table receives a trigger. Unknown later writers are captured
-- as unsupported events, so an incomplete adapter cannot claim a safe closure.
CREATE FUNCTION recovery_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE recovery_safe_row(to_jsonb(OLD)) END;
 a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE recovery_safe_row(to_jsonb(NEW)) END;
 r JSONB := COALESCE(a,b);
 root_id TEXT;
 event_id TEXT;
 active_root TEXT := NULLIF(current_setting('shbs.recovery_action',true),'');
 event_kind TEXT := NULLIF(current_setting('shbs.recovery_kind',true),'');
 record_id TEXT;
BEGIN
 IF current_setting('shbs.recovery_compensating',true) = '1' THEN RETURN COALESCE(NEW,OLD); END IF;
 -- Mailbox challenges and guess counters are preparation, not a committed
 -- membership event. Consumption/expiry/generation changes remain visible.
 IF TG_TABLE_NAME IN ('RegistrationCode','AccountInvitation') AND TG_OP='UPDATE' AND a=b THEN RETURN NEW; END IF;
 FOR root_id IN
   SELECT DISTINCT t."actionId" FROM "RecoveryTrackedEntity" t
   WHERE t."recordId" IN (SELECT value #>> '{}' FROM
     (SELECT value FROM jsonb_each(COALESCE(a,'{}')) UNION ALL SELECT value FROM jsonb_each(COALESCE(b,'{}'))) refs
     WHERE jsonb_typeof(value) = 'string')
   UNION SELECT active_root WHERE active_root IS NOT NULL
   ORDER BY 1
 LOOP
   -- Serialize every descendant with apply. Serializable apply also retries or
   -- rejects a stale snapshot after a waiting writer commits.
   PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id,0));
   IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId"=root_id) THEN
     -- A completed void cannot acquire new descendants through a stale writer.
     IF TG_OP <> 'DELETE' AND
       ((TG_TABLE_NAME IN ('Pairing','Session','QualificationGrant') AND r->>'tutorId' = (SELECT "after"->'tutor'->>'id' FROM "RecoveryAction" WHERE id=root_id))
         OR (TG_TABLE_NAME='PairingTutee' AND EXISTS(SELECT 1 FROM "Pairing" p JOIN "RecoveryAction" ra ON ra.id=root_id WHERE p.id=r->>'pairingId' AND p."tutorId"=ra."after"->'tutor'->>'id')))
       AND NOT EXISTS(SELECT 1 FROM "TutorApplication" admitted JOIN "RecoveryAction" ra ON ra.id=root_id
         WHERE admitted.type='INITIAL' AND admitted.status='ACCEPTED' AND admitted."promotedTutorId"=ra."after"->'tutor'->>'id'
           AND (admitted.id<>ra."applicationId" OR EXISTS(SELECT 1 FROM "RecoveryAction" fresh
             WHERE fresh.id<>root_id AND fresh."applicationId"=admitted.id AND fresh."after"->'tutor'->>'id'=admitted."promotedTutorId"
               AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" voided WHERE voided."actionId"=fresh.id))))
       AND (SELECT "before"->'tutor'->>'status' IS DISTINCT FROM 'ACTIVE' FROM "RecoveryAction" WHERE id=root_id) THEN
       RAISE EXCEPTION 'Admission was voided; reload assignment state' USING ERRCODE='40001';
     END IF;
     CONTINUE;
   END IF;
   INSERT INTO "RecoveryFence"("actionId","revision") VALUES(root_id,1)
     ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1;
   event_id := md5(root_id || ':' || txid_current()::text);
   INSERT INTO "RecoveryEvent"("id","actionId","transactionId","kind") VALUES
    (event_id,root_id,txid_current()::text,COALESCE(CASE WHEN root_id=active_root THEN event_kind END,CASE WHEN TG_TABLE_NAME IN ('Pairing','PairingTutee') AND TG_OP='INSERT' THEN 'ASSIGNMENT' WHEN TG_TABLE_NAME='AccountInvitation' THEN 'INVITATION' ELSE 'UNSUPPORTED' END))
    ON CONFLICT ("actionId","transactionId") DO NOTHING;
   INSERT INTO "RecoveryChange"("actionId","eventId","entity","operation","recordKey","before","after")
    VALUES(root_id,event_id,TG_TABLE_NAME,TG_OP,
      COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key='id' OR key LIKE '%Id'),'{}'),b,a);
   record_id := r->>'id';
   IF record_id IS NOT NULL THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,TG_TABLE_NAME,record_id) ON CONFLICT DO NOTHING;
   END IF;
   -- Pairing membership propagates scope to its student, but never to unrelated
   -- foreign keys such as the administrator, programme term or shared subject.
   IF TG_TABLE_NAME='PairingTutee' THEN
     INSERT INTO "RecoveryTrackedEntity" VALUES(root_id,'Tutee',r->>'tuteeId') ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END $$;

DO $$ DECLARE t RECORD; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename NOT LIKE 'Recovery%' AND tablename <> '_prisma_migrations'
  AND tablename NOT IN ('AuditLog','Notification','EmailDelivery','EmailOutbox','SignupMailAttempt','UsernameNamespaceGuard','SignupQuota','SignupLease','PublicApplicationRateLimit','CaptchaProof','CaptchaGrant')
 LOOP EXECUTE format('CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION recovery_capture_change()',t.tablename); END LOOP;
END $$;

CREATE FUNCTION recovery_immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Recovery evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER recovery_change_immutable BEFORE UPDATE OR DELETE ON "RecoveryChange" FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();
CREATE TRIGGER recovery_receipt_immutable BEFORE UPDATE OR DELETE ON "RecoveryReceipt" FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();
CREATE TRIGGER recovery_event_immutable BEFORE UPDATE OR DELETE ON "RecoveryEvent" FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();
CREATE FUNCTION recovery_action_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD."after" IS NOT NULL OR NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."applicationId" IS DISTINCT FROM OLD."applicationId" OR NEW."before" IS DISTINCT FROM OLD."before" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."after" IS NULL THEN
   RAISE EXCEPTION 'Finalized recovery provenance is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_action_immutable BEFORE UPDATE OR DELETE ON "RecoveryAction" FOR EACH ROW EXECUTE FUNCTION recovery_action_finalization();
CREATE TRIGGER recovery_scope_immutable BEFORE UPDATE OR DELETE ON "RecoveryTrackedEntity" FOR EACH ROW EXECUTE FUNCTION recovery_immutable_evidence();

-- Null credentials plus generation revocation deny sign-in and all old JWTs.
-- The permanent marker additionally fences every password writer, including
-- forgot-password and stale invitations, rather than relying on suspension.
CREATE FUNCTION recovery_voided_credentials() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."recoveryVoidedAt" IS NOT NULL AND (NEW."recoveryVoidedAt" IS NULL OR NEW."passwordHash" IS NOT NULL) THEN
   IF NOT EXISTS(SELECT 1 FROM "RecoveryAction" ra JOIN "TutorApplication" a ON a.id=ra."applicationId"
     WHERE ra.id=NULLIF(current_setting('shbs.recovery_reauthorize',true),'') AND a.type='INITIAL' AND a.status='ACCEPTED' AND ra."after"->'tutor'->>'id'=NEW."tutorId"
       AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" rr WHERE rr."actionId"=ra.id)) THEN
     RAISE EXCEPTION 'Voided admission credentials require fresh independent authorization' USING ERRCODE='23514';
   END IF;
 END IF;
 IF NEW."recoveryVoidedAt" IS NOT NULL THEN NEW."passwordHash" := NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_recovery_void_guard BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION recovery_voided_credentials();

CREATE OR REPLACE FUNCTION advance_account_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" OR OLD."recoveryVoidedAt" IS DISTINCT FROM NEW."recoveryVoidedAt" THEN
   NEW."sessionVersion" := OLD."sessionVersion" + 1;
 ELSE NEW."sessionVersion" := OLD."sessionVersion";
 END IF;
 RETURN NEW;
END $$;
