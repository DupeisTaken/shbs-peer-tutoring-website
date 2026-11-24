BEGIN;

-- Durable immutable receipt for operator-reviewed archive provenance reconciliation.
CREATE TABLE "ArchiveProvenanceReceipt" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "clientKey" UUID NOT NULL,
  "inputHash" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'OPERATOR',
  "evidence" JSONB NOT NULL,
  "subjects" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ArchiveProvenanceReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchiveProvenanceReceipt_actorId_clientKey_key"
  ON "ArchiveProvenanceReceipt"("actorId", "clientKey");
CREATE INDEX "ArchiveProvenanceReceipt_createdAt_idx"
  ON "ArchiveProvenanceReceipt"("createdAt");

CREATE FUNCTION archive_provenance_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archive provenance receipts are immutable' USING ERRCODE='23514';
END $$;

CREATE TRIGGER archive_provenance_receipt_immutable BEFORE UPDATE OR DELETE ON "ArchiveProvenanceReceipt"
  FOR EACH ROW EXECUTE FUNCTION archive_provenance_receipt_immutable();

-- Explicit typed recovery references for scalar, single-non-id, and composite
-- ImportedRecordProvenance keys. Composite markers expand into their exact parent
-- entities so standalone provenance changes always fence overlapping recovery roots.
CREATE FUNCTION imported_provenance_references(row_data JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  ent TEXT;
  rec_id TEXT;
  refs JSONB := '[]'::jsonb;
  parsed JSONB;
  pair JSONB;
  k TEXT;
  v TEXT;
  flag_id TEXT;
  r RECORD;
  cw_user TEXT;
  cw_start TEXT;
BEGIN
  IF row_data IS NULL THEN RETURN refs; END IF;
  ent := row_data->>'entity';
  rec_id := row_data->>'recordId';
  IF ent IS NULL OR rec_id IS NULL THEN RETURN refs; END IF;

  refs := refs || jsonb_build_array(
    jsonb_build_object(
      'entity', 'ImportedRecordProvenance',
      'recordId', jsonb_build_object('entity', ent, 'recordId', rec_id)::text
    )
  );

  IF left(rec_id, 1) = '[' THEN
    BEGIN
      parsed := rec_id::jsonb;
    EXCEPTION WHEN invalid_text_representation OR data_exception THEN
      parsed := NULL;
    END;
    IF parsed IS NOT NULL AND jsonb_typeof(parsed) = 'array' THEN
      FOR pair IN SELECT value FROM jsonb_array_elements(parsed) LOOP
        IF jsonb_typeof(pair) = 'array' AND jsonb_array_length(pair) = 2
           AND jsonb_typeof(pair->0) = 'string' AND jsonb_typeof(pair->1) = 'string' THEN
          k := pair->>0;
          v := pair->>1;
          IF ent = 'SessionTutee' THEN
            IF k = 'sessionId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', v));
              FOR r IN SELECT "mergeGroupId", "pairingId", "tutorId" FROM "Session" WHERE id = v LOOP
                IF r."mergeGroupId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."mergeGroupId")); END IF;
                IF r."pairingId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Pairing', 'recordId', r."pairingId")); END IF;
                IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
              END LOOP;
            ELSIF k = 'tuteeId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', v));
            END IF;
          ELSIF ent = 'PairingTutee' THEN
            IF k = 'pairingId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Pairing', 'recordId', v));
              FOR r IN SELECT "tutorId", "termId" FROM "Pairing" WHERE id = v LOOP
                IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
                IF r."termId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Term', 'recordId', r."termId")); END IF;
              END LOOP;
            ELSIF k = 'tuteeId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', v));
            END IF;
          ELSIF ent IN ('InterviewAssignment', 'InterviewVote') THEN
            IF k = 'applicationId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'TutorApplication', 'recordId', v));
            ELSIF k = 'tutorId' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', v));
            END IF;
          ELSIF ent = 'TutorAvailability' THEN
            IF k = 'tutorId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', v));
            ELSIF k = 'slotId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'TimeSlot', 'recordId', v)); END IF;
          ELSIF ent = 'TuteeAvailability' THEN
            IF k = 'tuteeId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', v));
            ELSIF k = 'slotId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'TimeSlot', 'recordId', v)); END IF;
          ELSIF ent IN ('TutorSubjectWillingness', 'TutorQualification') THEN
            IF k = 'tutorId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', v));
            ELSIF k = 'subjectId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Subject', 'recordId', v)); END IF;
          ELSIF ent = 'QualificationGrant' THEN
            IF k = 'tutorId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', v));
            ELSIF k IN ('sourceSubjectId', 'subjectId') THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Subject', 'recordId', v)); END IF;
          ELSIF ent = 'PatrolCreditWindow' THEN
            IF k = 'crewUserId' THEN
              cw_user := v;
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', v));
            ELSIF k = 'windowStart' THEN
              cw_start := v;
            END IF;
          ELSIF ent = 'AnnouncementAck' THEN
            IF k = 'announcementId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Announcement', 'recordId', v));
            ELSIF k = 'userId' THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', v)); END IF;
          ELSIF ent IN ('TuteeRequestInvalidity', 'LegacySignupDecline', 'StudentProfileOwnership') THEN
            IF k = 'tuteeId' THEN
              refs := refs || jsonb_build_array(
                jsonb_build_object('entity', ent, 'recordId', v),
                jsonb_build_object('entity', 'Tutee', 'recordId', v)
              );
              IF ent = 'StudentProfileOwnership' THEN
                FOR r IN SELECT "userId" FROM "StudentProfileOwnership" WHERE "tuteeId" = v LOOP
                  IF r."userId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', r."userId")); END IF;
                END LOOP;
              END IF;
            END IF;
          ELSIF ent = 'AcademicProfile' THEN
            IF k = 'userId' THEN
              refs := refs || jsonb_build_array(
                jsonb_build_object('entity', 'AcademicProfile', 'recordId', v),
                jsonb_build_object('entity', 'User', 'recordId', v)
              );
            END IF;
          ELSIF ent = 'SchoolCalendarDay' THEN
            IF k = 'date' THEN
              refs := refs || jsonb_build_array(jsonb_build_object('entity', 'SchoolCalendarDay', 'recordId', v));
            END IF;
          END IF;
        END IF;
      END LOOP;
      IF ent = 'PatrolCreditWindow' AND cw_user IS NOT NULL AND cw_start IS NOT NULL THEN
        BEGIN
          FOR r IN SELECT "patrolId" FROM "PatrolCreditWindow"
            WHERE "crewUserId" = cw_user AND "windowStart" = cw_start::timestamp LOOP
            IF r."patrolId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Patrol', 'recordId', r."patrolId")); END IF;
          END LOOP;
        EXCEPTION WHEN invalid_text_representation OR data_exception THEN
          NULL;
        END;
      END IF;
    END IF;
    RETURN refs;
  END IF;

  -- Scalar primary key reference plus immediate structural parent entities.
  refs := refs || jsonb_build_array(jsonb_build_object('entity', ent, 'recordId', rec_id));

  IF ent = 'Session' THEN
    FOR r IN SELECT "mergeGroupId", "pairingId", "tutorId" FROM "Session" WHERE id = rec_id LOOP
      IF r."mergeGroupId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."mergeGroupId")); END IF;
      IF r."pairingId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Pairing', 'recordId', r."pairingId")); END IF;
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
    END LOOP;
    FOR r IN SELECT "tuteeId" FROM "SessionTutee" WHERE "sessionId" = rec_id LOOP
      refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."tuteeId"));
    END LOOP;
  ELSIF ent = 'SessionFlag' THEN
    FOR r IN SELECT "sessionId", "tutorId" FROM "SessionFlag" WHERE id = rec_id LOOP
      IF r."sessionId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."sessionId")); END IF;
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
    END LOOP;
  ELSIF ent = 'ServiceHourAdjustment' THEN
    FOR r IN SELECT "tutorId" FROM "ServiceHourAdjustment" WHERE id = rec_id LOOP
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
    END LOOP;
    IF rec_id LIKE 'flag:%' THEN
      flag_id := substring(rec_id FROM 6);
      refs := refs || jsonb_build_array(jsonb_build_object('entity', 'SessionFlag', 'recordId', flag_id));
      FOR r IN SELECT "sessionId" FROM "SessionFlag" WHERE id = flag_id LOOP
        IF r."sessionId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."sessionId")); END IF;
      END LOOP;
    ELSIF rec_id LIKE 'interview_%' THEN
      FOR r IN
        SELECT a.id AS app_id, t.id AS tutor_id
        FROM "TutorApplication" a
        JOIN "Tutor" t ON t.id = substring(rec_id FROM length('interview_' || a.id || '_') + 1)
        WHERE rec_id LIKE 'interview_' || a.id || '_%'
      LOOP
        refs := refs || jsonb_build_array(
          jsonb_build_object('entity', 'TutorApplication', 'recordId', r.app_id),
          jsonb_build_object('entity', 'Tutor', 'recordId', r.tutor_id)
        );
      END LOOP;
    ELSIF rec_id LIKE 'mtgabs_%' THEN
      FOR r IN
        SELECT m.id AS meeting_id, t.id AS tutor_id
        FROM "TutorMeeting" m
        JOIN "Tutor" t ON t.id = substring(rec_id FROM length('mtgabs_' || m.id || '_') + 1)
        WHERE rec_id LIKE 'mtgabs_' || m.id || '_%'
      LOOP
        refs := refs || jsonb_build_array(
          jsonb_build_object('entity', 'TutorMeeting', 'recordId', r.meeting_id),
          jsonb_build_object('entity', 'Tutor', 'recordId', r.tutor_id)
        );
      END LOOP;
    END IF;
  ELSIF ent = 'MeetingAttendance' THEN
    FOR r IN SELECT "meetingId", "tutorId" FROM "MeetingAttendance" WHERE id = rec_id LOOP
      IF r."meetingId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'TutorMeeting', 'recordId', r."meetingId")); END IF;
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
    END LOOP;
  ELSIF ent = 'Patrol' THEN
    FOR r IN SELECT "crewUserId" FROM "Patrol" WHERE id = rec_id LOOP
      IF r."crewUserId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', r."crewUserId")); END IF;
    END LOOP;
  ELSIF ent = 'PatrolObservation' THEN
    FOR r IN SELECT "patrolId" FROM "PatrolObservation" WHERE id = rec_id LOOP
      IF r."patrolId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Patrol', 'recordId', r."patrolId")); END IF;
    END LOOP;
  ELSIF ent = 'ApplicationSubjectIntent' THEN
    FOR r IN SELECT "applicationId" FROM "ApplicationSubjectIntent" WHERE id = rec_id LOOP
      IF r."applicationId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'TutorApplication', 'recordId', r."applicationId")); END IF;
    END LOOP;
  ELSIF ent = 'DisciplinaryCard' THEN
    FOR r IN SELECT "tuteeId", "sessionId" FROM "DisciplinaryCard" WHERE id = rec_id LOOP
      IF r."tuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."tuteeId")); END IF;
      IF r."sessionId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."sessionId")); END IF;
    END LOOP;
  ELSIF ent = 'TuteeRemovalRequest' THEN
    FOR r IN SELECT "tuteeId", "pairingId" FROM "TuteeRemovalRequest" WHERE id = rec_id LOOP
      IF r."tuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."tuteeId")); END IF;
      IF r."pairingId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Pairing', 'recordId', r."pairingId")); END IF;
    END LOOP;
  ELSIF ent = 'TutorStatusRequest' THEN
    FOR r IN SELECT "tutorId" FROM "TutorStatusRequest" WHERE id = rec_id LOOP
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
    END LOOP;
  ELSIF ent = 'CrewStatusRequest' THEN
    FOR r IN SELECT "userId" FROM "CrewStatusRequest" WHERE id = rec_id LOOP
      IF r."userId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', r."userId")); END IF;
    END LOOP;
  ELSIF ent = 'Pairing' THEN
    FOR r IN SELECT "tutorId", "termId" FROM "Pairing" WHERE id = rec_id LOOP
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
      IF r."termId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Term', 'recordId', r."termId")); END IF;
    END LOOP;
  ELSIF ent = 'StudentSurvey' THEN
    FOR r IN SELECT "tuteeId", "intakeTermId" FROM "StudentSurvey" WHERE id = rec_id LOOP
      IF r."tuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."tuteeId")); END IF;
      IF r."intakeTermId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Term', 'recordId', r."intakeTermId")); END IF;
    END LOOP;
  ELSIF ent = 'StudentRequestReview' THEN
    FOR r IN SELECT "surveyId", "legacyTuteeId", "pairingId" FROM "StudentRequestReview" WHERE id = rec_id LOOP
      IF r."surveyId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'StudentSurvey', 'recordId', r."surveyId")); END IF;
      IF r."legacyTuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."legacyTuteeId")); END IF;
      IF r."pairingId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Pairing', 'recordId', r."pairingId")); END IF;
    END LOOP;
  ELSIF ent = 'StudentQuarterBlock' THEN
    FOR r IN SELECT "surveyId", "legacyTuteeId", "userId" FROM "StudentQuarterBlock" WHERE id = rec_id LOOP
      IF r."surveyId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'StudentSurvey', 'recordId', r."surveyId")); END IF;
      IF r."legacyTuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."legacyTuteeId")); END IF;
      IF r."userId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', r."userId")); END IF;
    END LOOP;
  ELSIF ent = 'HistoricalAcademicRecord' THEN
    FOR r IN SELECT "tutorId", "tuteeId" FROM "HistoricalAcademicRecord" WHERE id = rec_id LOOP
      IF r."tutorId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutor', 'recordId', r."tutorId")); END IF;
      IF r."tuteeId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."tuteeId")); END IF;
    END LOOP;
  ELSIF ent = 'AcademicConfirmation' THEN
    FOR r IN SELECT "userId" FROM "AcademicConfirmation" WHERE id = rec_id LOOP
      IF r."userId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'User', 'recordId', r."userId")); END IF;
    END LOOP;
  ELSIF ent = 'StudentAppeal' THEN
    FOR r IN SELECT "studentId", "cardId" FROM "StudentAppeal" WHERE id = rec_id LOOP
      IF r."studentId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."studentId")); END IF;
      IF r."cardId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'DisciplinaryCard', 'recordId', r."cardId")); END IF;
    END LOOP;
  ELSIF ent = 'StudentFeedback' THEN
    FOR r IN SELECT "studentId", "sessionId" FROM "StudentFeedback" WHERE id = rec_id LOOP
      IF r."studentId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Tutee', 'recordId', r."studentId")); END IF;
      IF r."sessionId" IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('entity', 'Session', 'recordId', r."sessionId")); END IF;
    END LOOP;
  END IF;

  RETURN refs;
END $$;

-- Specialized recovery trigger for ImportedRecordProvenance: preserves exact
-- composite primary keys and unsupported-consequence fencing across scalar and
-- composite provenance markers.
CREATE FUNCTION recovery_capture_imported_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('entity', OLD.entity, 'recordId', OLD."recordId", 'importedAt', OLD."importedAt") END;
  a JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('entity', NEW.entity, 'recordId', NEW."recordId", 'importedAt', NEW."importedAt") END;
  r JSONB := COALESCE(a, b);
  record_key JSONB := jsonb_build_object('entity', r->'entity', 'recordId', r->'recordId');
  refs JSONB := imported_provenance_references(b) || imported_provenance_references(a);
  active_root TEXT := NULLIF(current_setting('shbs.recovery_action', true), '');
  compensating_root TEXT := NULLIF(current_setting('shbs.recovery_compensating', true), '');
  changed JSONB := CASE WHEN TG_OP = 'UPDATE' THEN
    (SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb) FROM jsonb_each(to_jsonb(NEW))
     WHERE value IS DISTINCT FROM to_jsonb(OLD)->key)
    ELSE NULL END;
  root_id TEXT;
  event_id TEXT;
BEGIN
  IF compensating_root = '1' THEN
    RAISE EXCEPTION 'Recovery compensation must identify one action' USING ERRCODE='23514';
  END IF;
  FOR root_id IN
    SELECT DISTINCT tracked."actionId"
    FROM "RecoveryTrackedEntity" tracked
    JOIN jsonb_to_recordset(refs) AS subject(entity TEXT, "recordId" TEXT)
      ON tracked.entity = subject.entity AND tracked."recordId" = subject."recordId"
    UNION SELECT active_root WHERE active_root IS NOT NULL
    ORDER BY 1
  LOOP
    IF root_id = compensating_root THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id, 0));
    IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId" = root_id) THEN CONTINUE; END IF;
    INSERT INTO "RecoveryFence"("actionId", revision) VALUES(root_id, 1)
      ON CONFLICT ("actionId") DO UPDATE SET revision = "RecoveryFence".revision + 1;
    event_id := md5(root_id || ':' || txid_current()::text);
    INSERT INTO "RecoveryEvent"(id, "actionId", "transactionId", kind)
      VALUES(event_id, root_id, txid_current()::text, CASE WHEN compensating_root IS NOT NULL THEN 'RECOVERY_COMPENSATION' ELSE 'UNSUPPORTED' END)
      ON CONFLICT ("actionId", "transactionId") DO NOTHING;
    INSERT INTO "RecoveryChange"("actionId", "eventId", entity, operation, "recordKey", before, after, "changedFields")
      VALUES(root_id, event_id, 'ImportedRecordProvenance', TG_OP, record_key, b, a, changed);
    INSERT INTO "RecoveryTrackedEntity"("actionId", entity, "recordId")
      VALUES(root_id, 'ImportedRecordProvenance', record_key::text) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS recovery_change_journal ON "ImportedRecordProvenance";
CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "ImportedRecordProvenance"
  FOR EACH ROW EXECUTE FUNCTION recovery_capture_imported_provenance();

-- Typed receipt journal trigger: only explicit typed subjects join recovery roots.
CREATE FUNCTION recovery_capture_archive_provenance_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  root_id TEXT;
  event_id TEXT;
  safe_subjects JSONB;
  safe_receipt JSONB;
  active_root TEXT := NULLIF(current_setting('shbs.recovery_action', true), '');
  compensating_root TEXT := NULLIF(current_setting('shbs.recovery_compensating', true), '');
BEGIN
  IF compensating_root = '1' THEN
    RAISE EXCEPTION 'Recovery compensation must identify one action' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('entity', s.entity, 'recordId', s."recordId")), '[]'::jsonb)
    INTO safe_subjects
    FROM jsonb_to_recordset(CASE WHEN TG_OP = 'DELETE' THEN OLD.subjects ELSE NEW.subjects END) AS s(entity TEXT, "recordId" TEXT)
    WHERE s.entity IS NOT NULL AND s."recordId" IS NOT NULL;
  safe_receipt := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
    'id', NEW.id,
    'planHash', NEW."planHash",
    'fingerprint', NEW.fingerprint,
    'channel', NEW.channel,
    'subjects', safe_subjects
  ) END;
  FOR root_id IN
    SELECT DISTINCT tracked."actionId"
    FROM "RecoveryTrackedEntity" tracked
    JOIN jsonb_to_recordset(safe_subjects) AS subject(entity TEXT, "recordId" TEXT)
      ON tracked.entity = subject.entity AND tracked."recordId" = subject."recordId"
    UNION SELECT active_root WHERE active_root IS NOT NULL
    ORDER BY 1
  LOOP
    IF root_id = compensating_root THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || root_id, 0));
    IF EXISTS(SELECT 1 FROM "RecoveryReceipt" WHERE "actionId" = root_id) THEN CONTINUE; END IF;
    INSERT INTO "RecoveryFence"("actionId", revision) VALUES(root_id, 1)
      ON CONFLICT ("actionId") DO UPDATE SET revision = "RecoveryFence".revision + 1;
    event_id := md5(root_id || ':' || txid_current()::text);
    INSERT INTO "RecoveryEvent"(id, "actionId", "transactionId", kind)
      VALUES(event_id, root_id, txid_current()::text, CASE WHEN compensating_root IS NOT NULL THEN 'RECOVERY_COMPENSATION' ELSE 'UNSUPPORTED' END)
      ON CONFLICT ("actionId", "transactionId") DO NOTHING;
    INSERT INTO "RecoveryChange"("actionId", "eventId", entity, operation, "recordKey", before, after, "changedFields")
      VALUES(
        root_id,
        event_id,
        'ArchiveProvenanceReceipt',
        TG_OP,
        jsonb_build_object('id', COALESCE(NEW.id, OLD.id)),
        NULL,
        safe_receipt,
        (SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(to_jsonb(COALESCE(NEW, OLD))) AS field(key))
      );
    INSERT INTO "RecoveryTrackedEntity"("actionId", entity, "recordId")
      VALUES(root_id, 'ArchiveProvenanceReceipt', COALESCE(NEW.id, OLD.id)) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "ArchiveProvenanceReceipt"
  FOR EACH ROW EXECUTE FUNCTION recovery_capture_archive_provenance_receipt();

COMMIT;
