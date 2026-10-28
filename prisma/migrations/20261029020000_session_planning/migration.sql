-- Additive dated planning. No attendance clocks, service credits, surveys or old slots change.
CREATE TABLE "SessionPlan" (
  "id" TEXT NOT NULL, "generationKey" TEXT NOT NULL, "tutorId" TEXT NOT NULL,
  "termId" TEXT NOT NULL, "originalDate" TEXT NOT NULL, "timeZone" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'REGULAR', "sourceFingerprint" TEXT NOT NULL, "sourceScheduleFingerprint" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlan_kind_check" CHECK ("kind" IN ('REGULAR','EXTRA'))
);
CREATE UNIQUE INDEX "SessionPlan_generationKey_key" ON "SessionPlan"("generationKey");
CREATE INDEX "SessionPlan_tutorId_originalDate_idx" ON "SessionPlan"("tutorId","originalDate");
CREATE TABLE "SessionPlanAssignment" (
  "planId" TEXT NOT NULL, "pairingId" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "tuteeIds" JSONB NOT NULL, "primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SessionPlanAssignment_pkey" PRIMARY KEY ("planId","pairingId")
);
CREATE TABLE "SessionPlanCohort" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "date" TEXT NOT NULL,
  "startMin" INTEGER NOT NULL, "endMin" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "roomId" TEXT, "online" BOOLEAN NOT NULL DEFAULT false, "rescheduled" BOOLEAN NOT NULL DEFAULT false, "sourceInvalidated" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPlanCohort_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlanCohort_clock_check" CHECK ("startMin" >= 0 AND "endMin" <= 1440 AND "endMin"-"startMin"=45 AND "endsAt">"startsAt"),
  CONSTRAINT "SessionPlanCohort_status_check" CHECK ("status" IN ('SCHEDULED','CANCELLED','RECORDED'))
);
CREATE INDEX "SessionPlanCohort_startsAt_status_idx" ON "SessionPlanCohort"("startsAt","status");
CREATE INDEX "SessionPlanCohort_planId_idx" ON "SessionPlanCohort"("planId");
CREATE TABLE "SessionPlanParticipant" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "tuteeId" TEXT NOT NULL, "cohortId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED', "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SessionPlanParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlanParticipant_status_check" CHECK ("status" IN ('SCHEDULED','CANCELLED'))
);
CREATE UNIQUE INDEX "SessionPlanParticipant_planId_tuteeId_key" ON "SessionPlanParticipant"("planId","tuteeId");
CREATE INDEX "SessionPlanParticipant_cohortId_status_idx" ON "SessionPlanParticipant"("cohortId","status");
CREATE TABLE "SessionPlanningSuggestion" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "cohortId" TEXT NOT NULL, "tuteeId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL, "sourceVersion" INTEGER NOT NULL, "date" TEXT NOT NULL,
  "startMin" INTEGER NOT NULL, "roomId" TEXT, "online" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPlanningSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SessionPlanningSuggestion_planId_tuteeId_idx" ON "SessionPlanningSuggestion"("planId","tuteeId");
CREATE TABLE "SessionPlanningRequest" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "cohortId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "scope" TEXT NOT NULL, "participantIds" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "stage" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 1, "currentOfferId" TEXT,
  "parentRequestId" TEXT, "rejectionKeys" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPlanningRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlanningRequest_scope_check" CHECK ("scope" IN ('ONE','ALL')),
  CONSTRAINT "SessionPlanningRequest_kind_check" CHECK ("kind" IN ('RESCHEDULE','EXTRA')),
  CONSTRAINT "SessionPlanningRequest_stage_check" CHECK ("stage" BETWEEN 1 AND 3),
  CONSTRAINT "SessionPlanningRequest_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED','STALE','SPLIT_REQUESTED','SPLIT'))
);
CREATE INDEX "SessionPlanningRequest_status_planId_idx" ON "SessionPlanningRequest"("status","planId");
CREATE TABLE "SessionPlanningOffer" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "authorKey" TEXT NOT NULL,
  "date" TEXT NOT NULL, "startMin" INTEGER NOT NULL, "endMin" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "roomId" TEXT, "online" BOOLEAN NOT NULL DEFAULT false, "cutoffAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPlanningOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlanningOffer_clock_check" CHECK ("startMin">=0 AND "endMin"<=1440 AND "endMin"-"startMin"=45 AND "endsAt">"startsAt")
);
CREATE UNIQUE INDEX "SessionPlanningOffer_requestId_sequence_key" ON "SessionPlanningOffer"("requestId","sequence");
CREATE TABLE "SessionPlanningResponse" (
  "id" TEXT NOT NULL, "offerId" TEXT NOT NULL, "actorKey" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING', "acceptedBy" TEXT, "deliveredAt" TIMESTAMP(3),
  "deadline" TIMESTAMP(3), "respondedAt" TIMESTAMP(3),
  CONSTRAINT "SessionPlanningResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlanningResponse_state_check" CHECK ("state" IN ('PENDING','ACCEPTED','REJECTED')),
  CONSTRAINT "SessionPlanningResponse_deadline_check" CHECK ("deadline" IS NULL OR "deliveredAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "SessionPlanningResponse_offerId_actorKey_key" ON "SessionPlanningResponse"("offerId","actorKey");
CREATE INDEX "SessionPlanningResponse_state_deadline_idx" ON "SessionPlanningResponse"("state","deadline");
CREATE TABLE "SessionPlanningReceipt" (
  "actorId" TEXT NOT NULL, "clientKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPlanningReceipt_pkey" PRIMARY KEY ("actorId","clientKey")
);
CREATE TABLE "SessionNotice" (
  "id" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "requestId" TEXT, "offerId" TEXT, "responseId" TEXT,
  "recipientUserId" TEXT NOT NULL, "recipientEmail" TEXT NOT NULL, "event" TEXT NOT NULL, "context" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3), "attemptId" TEXT,
  "attemptStartedAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionNotice_dedupeKey_key" ON "SessionNotice"("dedupeKey");
CREATE INDEX "SessionNotice_status_availableAt_priority_idx" ON "SessionNotice"("status","availableAt","priority");
CREATE TABLE "SessionCalendarToken" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3),
  CONSTRAINT "SessionCalendarToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionCalendarToken_tokenHash_key" ON "SessionCalendarToken"("tokenHash");
CREATE INDEX "SessionCalendarToken_userId_revokedAt_idx" ON "SessionCalendarToken"("userId","revokedAt");

ALTER TABLE "SessionPlan" ADD CONSTRAINT "SessionPlan_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlan" ADD CONSTRAINT "SessionPlan_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanAssignment" ADD CONSTRAINT "SessionPlanAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanCohort" ADD CONSTRAINT "SessionPlanCohort_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanParticipant" ADD CONSTRAINT "SessionPlanParticipant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanParticipant" ADD CONSTRAINT "SessionPlanParticipant_tuteeId_fkey" FOREIGN KEY ("tuteeId") REFERENCES "Tutee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanParticipant" ADD CONSTRAINT "SessionPlanParticipant_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "SessionPlanCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanningSuggestion" ADD CONSTRAINT "SessionPlanningSuggestion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanningRequest" ADD CONSTRAINT "SessionPlanningRequest_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanningRequest" ADD CONSTRAINT "SessionPlanningRequest_parentRequestId_fkey" FOREIGN KEY ("parentRequestId") REFERENCES "SessionPlanningRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanningOffer" ADD CONSTRAINT "SessionPlanningOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SessionPlanningRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionPlanningResponse" ADD CONSTRAINT "SessionPlanningResponse_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SessionPlanningOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionNotice" ADD CONSTRAINT "SessionNotice_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SessionPlanningResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionNotice" ADD CONSTRAINT "SessionNotice_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionCalendarToken" ADD CONSTRAINT "SessionCalendarToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD COLUMN "planningCohortId" TEXT;
ALTER TABLE "Session" ADD CONSTRAINT "Session_planningCohortId_fkey" FOREIGN KEY ("planningCohortId") REFERENCES "SessionPlanCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Session_planningCohortId_pairingId_key" ON "Session"("planningCohortId","pairingId");

-- A participant cannot be placed into another lesson's cohort even through direct SQL.
CREATE FUNCTION enforce_session_plan_participant_cohort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cohortId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SessionPlanCohort" c WHERE c.id=NEW."cohortId" AND c."planId"=NEW."planId") THEN
    RAISE EXCEPTION 'Participant and cohort must belong to the same dated lesson';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_plan_participant_cohort BEFORE INSERT OR UPDATE OF "planId","cohortId" ON "SessionPlanParticipant" FOR EACH ROW EXECUTE FUNCTION enforce_session_plan_participant_cohort();
