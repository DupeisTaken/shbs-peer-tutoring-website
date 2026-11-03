import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalizeParity,
  compareParity,
  type ParityTables,
} from "./parity";

function fixture(prefix: string, sequence = 1n): ParityTables {
  const planId = `${prefix}-plan-generated`;
  const cohortId = `${prefix}-cohort-generated`;
  const actionId = `${prefix}-action-generated`;
  const eventId = `${prefix}-event-generated`;
  return {
    Pairing: [{ id: "source-pairing", roomVersion: 2, roomNeedsAssignment: false, roomShortageKey: null }],
    SessionPlan: [{
      id: planId, generationKey: "regular:source-term:source-pairing:2050-01-10:roster",
      kind: "REGULAR", tutorId: "source-tutor", termId: "source-term",
      createdAt: new Date("2050-01-01T00:00:00Z"), updatedAt: new Date("2050-01-01T00:00:00Z"),
    }],
    SessionPlanAssignment: [{ planId, pairingId: "source-pairing", subject: "Physics", tuteeIds: ["source-tutee"], primary: true }],
    SessionPlanCohort: [{
      id: cohortId, planId, date: "2050-01-10", startMin: 600, endMin: 645,
      startsAt: new Date("2050-01-10T02:00:00Z"), endsAt: new Date("2050-01-10T02:45:00Z"),
      roomId: null, online: false, rescheduled: false, status: "SCHEDULED", version: 1,
    }],
    SessionPlanParticipant: [{
      id: `${prefix}-participant-generated`, planId, cohortId,
      tuteeId: "source-tutee", status: "SCHEDULED", scheduleOverride: false,
      calendarSuppressed: false, version: 1,
    }],
    StudentContinuationAssignment: [{
      id: `${prefix}-continuation-generated`, surveyId: "source-survey",
      sourcePairingId: "prior-pairing", targetPairingId: "source-pairing",
      tuteeId: "source-tutee", status: "ASSIGNED",
      assignedAt: new Date("2050-01-01T00:00:00Z"), snapshot: { released: [] },
    }],
    SessionNotice: [{
      id: `${prefix}-notice-generated`, dedupeKey: `cohort:${cohortId}:1:schedule_updated:tutee:source-tutee`,
      recipientUserId: "source-user", status: "PENDING", attempts: 0,
      context: { startsAt: "2050-01-10T02:00:00.000Z", isActionable: false },
    }],
    RecoveryAction: [{ id: actionId, kind: "ADMISSION", applicationId: "source-application", before: { tutor: null }, after: { tutor: { id: "source-tutor" } } }],
    RecoveryEvent: [{ id: eventId, actionId, transactionId: `${prefix}-transaction-generated`, kind: "UNSUPPORTED" }],
    RecoveryChange: [
      { id: sequence, actionId, eventId, entity: "SessionPlanCohort", operation: "INSERT", recordKey: { id: cohortId }, before: null, after: { id: cohortId, planId, version: 1 }, changedFields: null },
      { id: sequence + 8n, actionId, eventId, entity: "SessionPlanCohort", operation: "UPDATE", recordKey: { id: cohortId }, before: { id: cohortId, version: 1 }, after: { id: cohortId, version: 2 }, changedFields: ["version"] },
    ],
    RecoveryTrackedEntity: [{ actionId, entity: "SessionPlan", recordId: planId }],
    RecoveryFence: [{ actionId, revision: 2 }],
  };
}

void test("normalizes generated references and sequence gaps while retaining complete contents", () => {
  compareParity(canonicalizeParity(fixture("before", 1n)), canonicalizeParity(fixture("after", 700n)));
});

void test("procedure outputs use persisted identity aliases and retain changed return contents", () => {
  const before = canonicalizeParity(fixture("before"), {
    procedureResults: [{ label: "response", result: { id: "before-cohort-generated", accepted: true } }],
  });
  compareParity(canonicalizeParity(fixture("after"), {
    procedureResults: [{ label: "response", result: { id: "after-cohort-generated", accepted: true } }],
  }), before);
  assert.throws(() => compareParity(canonicalizeParity(fixture("after"), {
    procedureResults: [{ label: "response", result: { id: "after-cohort-generated", accepted: false } }],
  }), before));
});

void test("operation-created pairings require receipt-backed identity while seeded IDs stay exact", () => {
  const creation = (prefix: string) => {
    const tables = fixture(prefix);
    const actorId = "source-admin";
    const clientKey = `${prefix}-creation-client-generated`;
    const resultId = `${prefix}-pairing-generated`;
    const input = {
      clientKey, tutorId: "source-tutor", subject: "Physics", subjectId: "source-subject",
      timeSlotId: "source-slot", roomMode: "AUTO", tuteeIds: ["source-tutee"],
    };
    const semanticInput = {
      tutorId: input.tutorId, subject: input.subject, subjectId: input.subjectId,
      timeSlotId: input.timeSlotId, roomMode: input.roomMode, roomId: null, tuteeIds: input.tuteeIds,
    };
    tables.Pairing = [...tables.Pairing!, {
      id: resultId, tutorId: input.tutorId, subject: input.subject,
      timeSlotId: input.timeSlotId, roomVersion: 0, roomMode: "AUTO", roomNeedsAssignment: false,
    }];
    tables.PairingCreationRequest = [{
      actorId, clientKey, pairingId: resultId,
      payloadHash: createHash("sha256").update(JSON.stringify(semanticInput)).digest("hex"),
    }];
    const options = {
      seededPairingIds: ["source-pairing"],
      pairingCreations: [{ actorId, clientKey, input, resultId }],
      procedureResults: [{ label: "created-and-retried", result: [{ id: resultId }, { id: resultId }] }],
    };
    return { tables, options };
  };
  const before = creation("before");
  const after = creation("after");
  compareParity(canonicalizeParity(after.tables, after.options), canonicalizeParity(before.tables, before.options));
  assert.throws(() => compareParity(canonicalizeParity(after.tables), canonicalizeParity(before.tables)));
  const changedSource = creation("after");
  changedSource.tables.Pairing![0]!.id = "different-source-pairing";
  assert.throws(() => compareParity(canonicalizeParity(changedSource.tables, changedSource.options), canonicalizeParity(before.tables, before.options)));
  const forgedSource = creation("after");
  forgedSource.tables.PairingCreationRequest![0]!.pairingId = "source-pairing";
  forgedSource.options.pairingCreations[0]!.resultId = "source-pairing";
  assert.throws(() => canonicalizeParity(forgedSource.tables, forgedSource.options), /seeded source ID/);
  const wrongReceipt = creation("after");
  wrongReceipt.tables.PairingCreationRequest![0]!.pairingId = "another-pairing-generated";
  assert.throws(() => canonicalizeParity(wrongReceipt.tables, wrongReceipt.options), /authoritative procedure result/);
  const wrongHash = creation("after");
  wrongHash.tables.PairingCreationRequest![0]!.payloadHash = "invalid-hash";
  assert.throws(() => canonicalizeParity(wrongHash.tables, wrongHash.options), /committed receipt hash/);
});

void test("changes to allocation state, recovery fences and row contents fail comparison", () => {
  const expected = canonicalizeParity(fixture("before"));
  for (const mutation of [
    (tables: ParityTables) => { tables.Pairing![0]!.roomVersion = 3; },
    (tables: ParityTables) => { tables.Pairing![0]!.roomNeedsAssignment = true; },
    (tables: ParityTables) => { tables.RecoveryFence![0]!.revision = 3; },
    (tables: ParityTables) => { tables.SessionPlanParticipant![0]!.scheduleOverride = true; },
    (tables: ParityTables) => { tables.SessionNotice![0]!.context = { isActionable: true }; },
  ]) {
    const actual = fixture("after");
    mutation(actual);
    assert.throws(() => compareParity(canonicalizeParity(actual), expected));
  }
});

void test("retains change order, duplicates and stored JSON array order", () => {
  const expected = canonicalizeParity(fixture("before"));
  const reordered = fixture("after");
  reordered.RecoveryChange![0]!.id = 90n;
  assert.throws(() => compareParity(canonicalizeParity(reordered), expected));
  const duplicate = fixture("after");
  duplicate.RecoveryTrackedEntity = [...duplicate.RecoveryTrackedEntity!, { ...duplicate.RecoveryTrackedEntity![0]! }];
  assert.throws(() => compareParity(canonicalizeParity(duplicate), expected));
  const arrayChanged = fixture("after");
  arrayChanged.SessionPlanAssignment![0]!.tuteeIds = ["source-other", "source-tutee"];
  assert.throws(() => compareParity(canonicalizeParity(arrayChanged), expected));
});

void test("createdAt omission retains the exact late-continuation publication boundary", () => {
  const expected = canonicalizeParity(fixture("before"));
  const laterPublication = fixture("after");
  laterPublication.SessionPlan![0]!.createdAt = new Date("2050-01-01T00:00:00.001Z");
  assert.throws(() => compareParity(canonicalizeParity(laterPublication), expected));
  const metadataOnly = fixture("after");
  metadataOnly.SessionPlan![0]!.updatedAt = new Date("2050-02-01T00:00:00Z");
  compareParity(canonicalizeParity(metadataOnly), expected);
});

void test("rejects duplicate semantic physical cohorts instead of coalescing rows", () => {
  const tables = fixture("before");
  const cohort = tables.SessionPlanCohort![0]!;
  tables.SessionPlanCohort = [cohort, { ...cohort, id: "different-cohort-generated" }];
  // Match the roster too; two physical events with this identity must remain an error.
  tables.SessionPlanParticipant = [
    ...tables.SessionPlanParticipant!,
    { ...tables.SessionPlanParticipant![0]!, id: "different-person-generated", cohortId: "different-cohort-generated" },
  ];
  assert.throws(() => canonicalizeParity(tables), /Ambiguous semantic identity/);
});

void test("requires an exact original receipt input before canonicalizing its opaque hash", () => {
  const withReceipt = (prefix: string) => {
    const tables = fixture(prefix);
    const actorId = "source-actor";
    const clientKey = `${prefix}-client-generated`;
    const input = ["propose", { cohortId: `${prefix}-cohort-generated`, expectedVersion: 1, clientKey }];
    tables.SessionPlanningReceipt = [{
      actorId, clientKey,
      payloadHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      result: { id: `${prefix}-cohort-generated` },
    }];
    return { tables, witness: { actorId, clientKey, input } };
  };
  const before = withReceipt("before");
  const after = withReceipt("after");
  assert.throws(() => compareParity(canonicalizeParity(after.tables), canonicalizeParity(before.tables)));
  compareParity(
    canonicalizeParity(after.tables, { receiptInputs: [after.witness] }),
    canonicalizeParity(before.tables, { receiptInputs: [before.witness] }),
  );
  assert.throws(() => canonicalizeParity(after.tables, {
    receiptInputs: [{ ...after.witness, input: ["propose", { expectedVersion: 2 }] }],
  }), /does not match stored payloadHash/);
});

void test("bounded operation clocks preserve equality, order, and exact deadline relations", () => {
  const at = (milliseconds: number) => new Date(Date.UTC(2050, 0, 1, 0, 0, 0, milliseconds));
  const snapshot = (prefix: string, responded: number, available: number) => {
    const tables = fixture(prefix);
    tables.ClockWitness = [{
      id: "stable-clock-witness", respondedAt: at(responded), availableAt: at(available),
      deadline: at(50), cutoffAt: at(90), deliveredAt: at(0),
    }];
    return canonicalizeParity(tables, {
      operationWindows: [{ label: "response", before: at(1).toISOString(), after: at(100).toISOString() }],
    });
  };
  compareParity(snapshot("after", 20, 30), snapshot("before", 10, 40));
  assert.throws(() => compareParity(snapshot("after", 50, 60), snapshot("before", 10, 40)));
  assert.throws(() => compareParity(snapshot("after", 40, 10), snapshot("before", 10, 40)));
  assert.throws(() => compareParity(snapshot("after", 20, 20), snapshot("before", 10, 40)));
});

void test("clock normalization rejects wide/overlapping windows and leaves domain deadlines exact", () => {
  const tables = fixture("before");
  tables.ClockWitness = [{ id: "stable-clock", respondedAt: new Date("2050-01-01T00:00:01Z") }];
  assert.throws(() => canonicalizeParity(tables, {
    operationWindows: [{ label: "too-wide", before: "2050-01-01T00:00:00Z", after: "2050-01-01T00:03:00Z" }],
  }), /exceeds 120s/);
  assert.throws(() => canonicalizeParity(tables, {
    operationWindows: [
      { label: "first", before: "2050-01-01T00:00:00Z", after: "2050-01-01T00:00:02Z" },
      { label: "second", before: "2050-01-01T00:00:01Z", after: "2050-01-01T00:00:03Z" },
    ],
  }), /Overlapping operation clock witnesses/);
  const withDeadline = (deadline: string) => canonicalizeParity({
    ClockWitness: [{ id: "stable-clock", deadline: new Date(deadline) }],
  }, {
    operationWindows: [{ label: "response", before: "2050-01-01T00:00:00Z", after: "2050-01-01T00:00:02Z" }],
  });
  assert.throws(() => compareParity(withDeadline("2050-01-01T00:00:01Z"), withDeadline("2050-01-01T00:00:01.001Z")));
});

void test("keeps cross-root recovery transaction membership", () => {
  const addRoot = (tables: ParityTables, transaction: string) => {
    const second = fixture("second");
    tables.RecoveryAction = [...tables.RecoveryAction!, { ...second.RecoveryAction![0]!, applicationId: "second-application" }];
    tables.RecoveryEvent = [...tables.RecoveryEvent!, { ...second.RecoveryEvent![0]!, transactionId: transaction }];
    tables.RecoveryChange = [...tables.RecoveryChange!, { ...second.RecoveryChange![0]!, id: 50n }];
    tables.RecoveryTrackedEntity = [...tables.RecoveryTrackedEntity!, ...second.RecoveryTrackedEntity!];
    tables.RecoveryFence = [...tables.RecoveryFence!, ...second.RecoveryFence!];
  };
  const shared = fixture("before");
  addRoot(shared, "before-transaction-generated");
  const separate = fixture("before");
  addRoot(separate, "another-transaction-generated");
  assert.throws(() => compareParity(canonicalizeParity(shared), canonicalizeParity(separate)));
});
