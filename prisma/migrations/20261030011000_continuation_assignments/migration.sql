CREATE TABLE "StudentContinuationAssignment" (
  "id" TEXT PRIMARY KEY, "surveyId" TEXT NOT NULL, "sourcePairingId" TEXT NOT NULL,
  "sourceTuteeId" TEXT NOT NULL, "targetTermId" TEXT NOT NULL, "targetPairingId" TEXT,
  "tuteeId" TEXT NOT NULL, "tutorId" TEXT, "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
  "reason" TEXT, "snapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "StudentContinuationAssignment_surveyId_sourcePairingId_key"
  ON "StudentContinuationAssignment"("surveyId","sourcePairingId");
CREATE INDEX "StudentContinuationAssignment_tutorId_targetTermId_status_idx"
  ON "StudentContinuationAssignment"("tutorId","targetTermId","status");
CREATE INDEX "StudentContinuationAssignment_targetPairingId_tuteeId_idx"
  ON "StudentContinuationAssignment"("targetPairingId","tuteeId");
CREATE TABLE "StudentContinuationPairing" (
  "sourcePairingId" TEXT NOT NULL, "targetTermId" TEXT NOT NULL,
  "pairingId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("sourcePairingId","targetTermId")
);
CREATE UNIQUE INDEX "StudentContinuationPairing_pairingId_key" ON "StudentContinuationPairing"("pairingId");
CREATE TABLE "SessionPlanContinuationMember" (
  "planId" TEXT NOT NULL, "pairingId" TEXT NOT NULL, "tuteeId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL, "joinedAt" TIMESTAMP(3) NOT NULL, "releasedAt" TIMESTAMP(3),
  PRIMARY KEY("planId","pairingId","tuteeId"),
  CONSTRAINT "SessionPlanContinuationMember_planId_fkey" FOREIGN KEY("planId") REFERENCES "SessionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SessionPlanContinuationMember_assignmentId_idx" ON "SessionPlanContinuationMember"("assignmentId");
