import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "../../../../generated/prisma";
import type { QuarterWithdrawalEvidence } from "~/server/student-quarter-withdrawal";
import type { TransactionDb } from "~/server/transactions";
import { UnsupportedCheckpointSnapshot } from "../checkpoint-contract";
import {
  quarterWithdrawalRecoveryBlocker,
  studentQuarterWithdrawalCheckpointAdapter as adapter,
} from "./student-quarter-withdrawal";

const mocks = vi.hoisted(() => ({ read: vi.fn(), lock: vi.fn() }));
// The domain's strict evidence schema and database reader have integration
// coverage. This fixture isolates root projection and never imports that runtime.
vi.mock("~/server/student-quarter-withdrawal", async () => {
  const { z } = await import("zod");
  return {
    quarterWithdrawalEvidenceSchema: z.custom<QuarterWithdrawalEvidence>(),
    readQuarterWithdrawalEvidence: mocks.read,
    lockQuarterWithdrawalScope: mocks.lock,
  };
});

const stamp = "2030-01-01T00:00:00.000Z";
const tx = {} as TransactionDb;
const reviewId = "actual-review";
function evidence(): QuarterWithdrawalEvidence {
  return {
    version: 1,
    review: { id: reviewId, surveyId: null, legacyTuteeId: "manual-origin", legacyIntakeTermId: "term",
      kind: "STUDENT_ABORT", state: "PENDING", requestedByUserId: "withdrawal-owner",
      pairingId: null, createdAt: stamp, resolvedAt: null, resolvedByUserId: null },
    authorityBlockers: [], owner: null, term: null, profiles: [], sources: [], assignments: [],
    effectiveAssignments: [{ surveyId: "external-survey", pairingId: "exact-pairing",
      sourceTuteeId: "external-source", tuteeId: "exact-executor" }],
    manualAssignments: [{ sourceTuteeId: "manual-origin", sourcePairingId: "manual-pairing",
      pairingId: "final-pairing", tuteeId: "final-executor", receiptId: "first-transfer", revision: 1,
      path: [
        { sourcePairingId: "manual-pairing", targetPairingId: "middle-pairing",
          sourceTuteeId: "manual-origin", targetTuteeId: "middle-executor", receiptId: "first-transfer",
          pairingRevision: 1, participantRevision: 1 },
        { sourcePairingId: "middle-pairing", targetPairingId: "final-pairing",
          sourceTuteeId: "middle-executor", targetTuteeId: "final-executor", receiptId: "second-transfer",
          pairingRevision: 2, participantRevision: 2 },
      ] }],
    pairings: [{ id: "published-source-pairing", termId: "term", tutorId: "original-tutor",
      subject: "Synthetic mathematics", scheduleConfirmed: true, dayOfWeek: 1,
      startMin: 960, endMin: 1020, roomVersion: 1 }],
    members: [], consolidations: [], pendingReviews: [], blocks: [],
    publication: {
      plans: [], participants: [], cohorts: [],
      continuationMembers: [{ planId: "plan", pairingId: "continued-pairing", tuteeId: "continued-executor",
        sourceTuteeId: "continued-source", sourceSurveyId: null, assignmentId: null,
        joinedAt: stamp, releasedAt: stamp }],
      executions: [{ participantId: "published-participant", tuteeId: "published-executor",
        sourceSurveyIds: ["published-source-survey"], revision: 1 }],
      planExecutions: [{ planId: "plan", tutorId: "execution-tutor", revision: 1,
        assignments: [{ sourcePairingId: "published-source-pairing", targetPairingId: "published-target-pairing" }] }],
      responseExecutions: [{ responseId: "response", userId: "current-response-user",
        profileKind: "TUTEE", profileId: "response-executor", revision: 2 }],
      requests: [{ id: "request", planId: "plan", status: "PENDING", version: 1, currentOfferId: "offer" }],
      responses: [{ id: "response", offerId: "offer", actorUserId: "original-response-user",
        actorKey: "tutee:original-profile", state: "PENDING", deadline: stamp, respondedAt: null }],
    },
  };
}

beforeEach(() => vi.clearAllMocks());

it("captures every manual successor hop and distinct publication source, actor and execution roots", async () => {
  mocks.read.mockResolvedValue(evidence());
  const captured = await adapter.capture(tx, reviewId);
  const roots = captured.scope.map((row) => `${row.entity}:${row.recordId}`);
  expect(roots).toEqual(expect.arrayContaining([
    "StudentRequestReview:actual-review", "StudentSurvey:external-survey", "Tutee:external-source",
    "Pairing:exact-pairing", "Tutee:exact-executor", "Pairing:manual-pairing", "Tutee:manual-origin",
    "Pairing:middle-pairing", "Tutee:middle-executor", "Pairing:final-pairing", "Tutee:final-executor",
    "PairingExecutionSuccessor:manual-pairing", "PairingExecutionSuccessor:middle-pairing",
    "Tutor:original-tutor", "Tutor:execution-tutor", "Term:term",
    "SessionPlan:plan", "SessionPlanExecution:plan", "Pairing:published-source-pairing", "Pairing:published-target-pairing",
    "Pairing:continued-pairing", "Tutee:continued-source", "Tutee:continued-executor",
    "SessionPlanParticipant:published-participant", "SessionParticipantExecution:published-participant",
    "StudentSurvey:published-source-survey", "Tutee:published-executor",
    "SessionPlanningRequest:request", "SessionPlanningOffer:offer", "SessionPlanningResponse:response",
    "SessionResponseExecution:response", "User:original-response-user", "User:current-response-user", "Tutee:response-executor",
  ]));
  expect(new Set(roots).size).toBe(roots.length);
  // actorKey records an immutable offer slot; it never invents a User reference.
  expect(roots).not.toContain("User:original-profile");
});

it("bounds the combined root set even when every evidence collection is individually bounded", async () => {
  const current = evidence();
  current.pairings = Array.from({ length: 1000 }, (_, index) => ({ ...current.pairings[0]!, id: `pairing-${index}` }));
  mocks.read.mockResolvedValue(current);
  await expect(adapter.capture(tx, reviewId)).rejects.toBeInstanceOf(UnsupportedCheckpointSnapshot);
});

it("inspects closed evidence without pending locks, preserves delivery scope and rejects direct apply", async () => {
  mocks.read.mockResolvedValue(evidence());
  const captured = await adapter.capture(tx, reviewId);
  const raw = captured.snapshot as Prisma.JsonValue;
  mocks.read.mockResolvedValue({ ...evidence(), review: { ...evidence().review, state: "APPROVED" } });
  await adapter.lock(tx, reviewId, raw);
  expect(mocks.lock).not.toHaveBeenCalled();
  const context = { actionId: "action", scope: captured.scope, changes: [], events: [] };
  const inspection = await adapter.inspect(tx, reviewId, raw, context);
  expect(inspection.blockers).toContain(quarterWithdrawalRecoveryBlocker);
  expect(inspection).not.toHaveProperty("compensatedEventIds");
  await expect(adapter.apply(tx, reviewId, raw, { id: "head" }, "Synthetic defensive apply", context))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: quarterWithdrawalRecoveryBlocker });
});
