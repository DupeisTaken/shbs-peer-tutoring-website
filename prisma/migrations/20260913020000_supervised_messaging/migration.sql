-- Preserve the participant-only promise made for every existing message. New deliveries
-- explicitly disclose supervision; this migration never retroactively opens old content.
ALTER TABLE "DirectMessage" ADD COLUMN "supervisable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hiddenAt" TIMESTAMP(3);
-- Old application instances also keep the safe participant-only default.
CREATE INDEX "DirectMessage_senderId_createdAt_idx" ON "DirectMessage"("senderId", "createdAt");
CREATE INDEX "DirectMessage_supervisable_createdAt_idx" ON "DirectMessage"("supervisable", "createdAt");
CREATE TABLE "MessageBatch" (
  "senderId" TEXT NOT NULL, "clientKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageBatch_pkey" PRIMARY KEY ("senderId", "clientKey")
);
CREATE TABLE "MessagePermission" (
  "scope" TEXT NOT NULL PRIMARY KEY, "groups" TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "MessageRestriction" (
  "userId" TEXT NOT NULL PRIMARY KEY, "restricted" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "MessageTutorAssignment" (
  "tuteeId" TEXT NOT NULL, "tutorId" TEXT NOT NULL, "source" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageTutorAssignment_pkey" PRIMARY KEY ("tuteeId", "tutorId")
);
CREATE TABLE "MessageModeration" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "messageId" TEXT,
  "targetUserId" TEXT, "action" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MessageModeration_messageId_createdAt_idx" ON "MessageModeration"("messageId", "createdAt");

INSERT INTO "MessageTutorAssignment" ("tuteeId", "tutorId", "source")
SELECT pt."tuteeId", p."tutorId", 'PAIRING_BACKFILL'
FROM "PairingTutee" pt JOIN "Pairing" p ON p.id = pt."pairingId"
ON CONFLICT DO NOTHING;
INSERT INTO "MessageTutorAssignment" ("tuteeId", "tutorId", "source")
SELECT st."tuteeId", s."tutorId", 'ATTENDANCE_BACKFILL'
FROM "SessionTutee" st JOIN "Session" s ON s.id = st."sessionId"
ON CONFLICT DO NOTHING;

-- Capture every assignment path (manual, intake, approval replay and nested writes).
CREATE FUNCTION remember_message_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "MessageTutorAssignment" ("tuteeId", "tutorId", "source")
  SELECT NEW."tuteeId", p."tutorId", 'PAIRING' FROM "Pairing" p WHERE p.id = NEW."pairingId"
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER message_assignment_member AFTER INSERT OR UPDATE ON "PairingTutee"
FOR EACH ROW EXECUTE FUNCTION remember_message_assignment();
CREATE FUNCTION remember_message_pairing_tutor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "MessageTutorAssignment" ("tuteeId", "tutorId", "source")
  SELECT pt."tuteeId", NEW."tutorId", 'PAIRING' FROM "PairingTutee" pt WHERE pt."pairingId" = NEW.id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER message_assignment_tutor AFTER UPDATE OF "tutorId" ON "Pairing"
FOR EACH ROW EXECUTE FUNCTION remember_message_pairing_tutor();
