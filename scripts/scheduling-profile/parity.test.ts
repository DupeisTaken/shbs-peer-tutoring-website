import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "../../generated/prisma";
import {
  canonicalizeParity,
  captureParity,
  compareParity,
  createParityAliasRewriter,
  selectParityCaptureSchema,
  type ParityTables,
} from "./parity";

void test("native-original selection is explicit and restricted to an unpaired cold HTTP latency control", () => {
  const cold = { scenario: "cold", mode: "latency", transport: "http", compare: false };
  assert.equal(selectParityCaptureSchema(undefined, cold), "shared");
  assert.equal(selectParityCaptureSchema("shared", { ...cold, compare: true }), "shared");
  assert.equal(selectParityCaptureSchema("native-original", cold), "native-original");
  for (const context of [
    { ...cold, compare: true }, { ...cold, scenario: "warm" },
    { ...cold, scenario: "all" }, { ...cold, mode: "diagnostic" },
    { ...cold, transport: "procedure" },
  ]) assert.throws(() => selectParityCaptureSchema("native-original", context), /unpaired cold HTTP latency/);
  assert.throws(() => selectParityCaptureSchema("auto", cold), /Unknown parity capture schema/);
});

void test("native-original capture uses positive original fields with no new model delegates", async () => {
  const absent = new Set([
    "personPartitionReceipt", "retiredHistoryOwnership", "historyRowOwnership", "personHistoryCorrectionReceipt",
    "personParticipationTransferReceipt", "participantConsolidation", "pairingExecutionSuccessor",
    "sessionPlanExecution", "sessionParticipantExecution", "sessionResponseExecution", "qualificationTransferGrant",
    "studentRequestExecutionAssignment", "recoveryCheckpoint", "recoveryDeliveryEffect",
    "recoveryDeliveryCancellation", "recoveryDeliveryCoverage", "recoveryWorkflowDraft",
  ]);
  const addedFields: Record<string, string> = {
    user: "historyAccessRevision", personCombineReceipt: "ownershipTransfers",
    sessionPlanContinuationMember: "sourceSurveyId", notification: "recoveryWithdrawnAt",
    emailDelivery: "sourceNotificationId",
  };
  const queries = new Set<string>();
  let open = false;
  const tx = new Proxy({}, {
    get: (_target, name) => {
      assert.equal(typeof name, "string");
      const delegate = name as string;
      assert.ok(!absent.has(delegate), `Original schema has no ${delegate} delegate`);
      return { findMany: (args?: { select?: Record<string, boolean> }) => {
        assert.equal(open, true);
        assert.ok(args?.select, `${delegate} must have a fixed positive native projection`);
        queries.add(delegate);
        if (addedFields[delegate]) assert.ok(!args.select[addedFields[delegate]], "New scalar field entered native capture");
        if (delegate === "user") assert.ok(!args.select.passwordHash);
        if (delegate === "studentSurvey") assert.ok(!args.select.tokenHash);
        return Promise.resolve([]);
      } };
    },
  });
  const db = { $transaction: async (work: (client: unknown) => Promise<unknown>, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead", timeout: 120_000 });
    open = true;
    try { return await work(tx); } finally { open = false; }
  } } as unknown as PrismaClient;
  const snapshot = await captureParity(db, { captureSchema: "native-original" });
  assert.equal(snapshot.captureSchema, "native-original");
  assert.equal(Object.keys(snapshot.tables).length, 51);
  for (const delegate of ["user", "personCombineReceipt", "sessionPlanContinuationMember", "notification", "emailDelivery", "recoveryChange"])
    assert.ok(queries.has(delegate), `${delegate} disappeared from original-schema evidence`);
  assert.ok(!Object.hasOwn(snapshot.tables, "RecoveryCheckpoint"));
  assert.throws(() => compareParity(snapshot, canonicalizeParity(
    Object.fromEntries(Object.keys(snapshot.tables).map((name) => [name, []])),
  )), /semantic state differs/);
});

void test("shared capture fails on missing combined fields or delegates instead of reducing its schema", async () => {
  for (const missing of ["field", "delegate"]) {
    const tx = new Proxy({}, {
      get: (_target, name) => {
        if (missing === "delegate" && name === "personPartitionReceipt") return undefined;
        return { findMany: (args?: { select?: Record<string, boolean> }) => {
          if (missing === "field" && name === "user") {
            assert.equal(args?.select?.historyAccessRevision, true);
            throw new Error("Original client has no historyAccessRevision field");
          }
          return Promise.resolve([]);
        } };
      },
    });
    const db = { $transaction: (work: (client: unknown) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    await assert.rejects(captureParity(db), missing === "field" ? /no historyAccessRevision field/ : TypeError);
  }
});

void test("incremental alias matching equals the original escaped longest-literal regex after every insertion", () => {
  const aliases = new Map<string, string>();
  const rewriter = createParityAliasRewriter();
  const oracle = (value: string) => {
    const exact = aliases.get(value);
    if (exact) return exact;
    const escaped = [...aliases.keys()]
      .filter((key) => key.length >= 8)
      .sort((left, right) => right.length - left.length)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!escaped.length) return value;
    return value.replace(new RegExp(escaped.join("|"), "g"), (key) => aliases.get(key)!);
  };
  const additions: [string, string][] = [
    ["short", "short exact alias"],
    ["abcdefgh", "alias containing bcdefghij and $&"],
    ["bcdefghij", "overlapping suffix"],
    ["abcdefghi", "longer prefix"],
    ["xxabcdefgh", "containing earlier key"],
    ["opaque.*+?^${}()|[]\\id", "literal punctuation"],
    ["line\nbreak-key", "literal newline"],
    ["emoji-😀-token", "literal UTF-16"],
    ["zero-alias", ""],
    ["abcdefghi", "updated same key"],
    ["short", "updated short alias"],
  ];
  const inputs = [
    "", "unmatched", "short", "prefix-short-suffix", "abcdefghij",
    "xxabcdefghij-abcdefgh-abcdefghi-bcdefghij",
    "prefix opaque.*+?^${}()|[]\\id suffix",
    "line\nbreak-key and emoji-😀-token", "zero-aliaszero-alias",
    ...additions.flatMap(([key]) => [key, `before:${key}:after`, `${key}${key}`]),
  ];
  for (const input of inputs) assert.equal(rewriter.replace(input), oracle(input));
  for (const [key, alias] of additions) {
    aliases.set(key, alias);
    rewriter.add(key, alias);
    for (const input of inputs)
      assert.equal(rewriter.replace(input), oracle(input), `Insertion ${JSON.stringify(key)}, input ${JSON.stringify(input)}`);
  }
});

void test("precomputed JSON sorting retains the original comparator order and duplicates", () => {
  const rows = [
    { id: "é", payload: ["second", "first"] },
    { id: "a", payload: ["first", "second"] },
    { id: "A", payload: ["second", "first"] },
    { id: "a", payload: ["first", "second"] },
    { id: "z", payload: ["first", "second"] },
  ];
  const expected = [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const snapshot = canonicalizeParity({ OpaqueRows: rows });
  assert.equal(JSON.stringify(snapshot.tables.OpaqueRows), JSON.stringify(expected));
  assert.equal(snapshot.tables.OpaqueRows?.length, rows.length);
});

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

/** Combined-schema evidence only, not a claim that the historical baseline can
 * execute identity transfers or prospective checkpoint recovery. */
function combinedFixture(prefix: string): ParityTables {
  const tables = fixture(prefix);
  const id = (kind: string) => `${prefix}-${kind}-generated`;
  const at = new Date("2050-01-01T00:00:00Z");
  const receipt = (kind: string) => ({
    id: id(kind), actorId: "source-admin", inputHash: `exact-${kind}-input-hash`,
    personId: "source-person", createdAt: at,
  });
  tables.Person = [
    { id: "source-person", revision: 4, primaryUserId: "source-user", resolutionState: "REVIEW_REQUIRED", mergedIntoId: null, createdAt: at, updatedAt: at },
    { id: id("partition-person"), revision: 1, primaryUserId: null, resolutionState: "REVIEW_REQUIRED", mergedIntoId: null, createdAt: at, updatedAt: at },
  ];
  tables.User = [{ id: "source-user", personId: "source-person", historyAccessRevision: 2, profileVersion: 1, sessionVersion: 3, recoveryVoidedAt: null }];
  tables.Tutor = [{ id: "source-tutor", personId: "source-person", status: "ACTIVE", historyIdentityRevision: 2 }];
  tables.Tutee = [{ id: "source-tutee", personId: id("partition-person"), status: "ACTIVE", historyIdentityRevision: 2 }];
  tables.TutorProfileOwnership = [{ tutorId: "source-tutor", userId: "source-user", revision: 2 }];
  tables.StudentProfileOwnership = [{ tuteeId: "source-tutee", userId: "source-user", revision: 3 }];
  tables.PersonCombineReceipt = [{ ...receipt("combine"), outcome: "REVIEW_REQUIRED", retiredUserIds: ["retired-user"], ownershipTransfers: [{ entity: "Notification", recordId: id("notification"), sourceUserId: "retired-user", readerUserId: "source-user" }] }];
  tables.PersonPartitionReceipt = [{ ...receipt("partition"), newPersonId: id("partition-person"), sources: [{ kind: "TUTEE", id: "source-tutee" }], subjects: [{ entity: "Person", recordId: id("partition-person") }] }];
  tables.PersonHistoryCorrectionReceipt = [{ ...receipt("history"), destinationPersonId: id("partition-person"), sourceUserIds: ["retired-user"], before: { readerUserId: "retired-user" }, after: { readerUserId: "source-user" }, subjects: [{ entity: "Notification", recordId: id("notification") }] }];
  tables.RetiredHistoryOwnership = [{ sourceUserId: "retired-user", readerUserId: "source-user", state: "ASSIGNED", revision: 2, receiptId: id("history"), updatedAt: at }];
  tables.HistoryRowOwnership = [{ entity: "Notification", recordId: id("notification"), readerUserId: "source-user", quarantineUserIds: ["retired-user"], sourceUserIds: ["retired-user"], revision: 3, receiptId: id("history"), updatedAt: at }];
  tables.PersonParticipationTransferReceipt = [{ ...receipt("participation"), retainedUserId: "source-user", selection: { tutorId: "source-tutor", participantIds: [id("participant")] }, result: { planIds: [id("plan")] }, subjects: [{ entity: "SessionPlan", recordId: id("plan") }] }];
  tables.ParticipantConsolidation = [{ kind: "TUTEE", sourceId: "old-tutee", targetId: "source-tutee", active: true, revision: 2, receiptId: id("participation"), effectiveAt: at }];
  tables.PairingExecutionSuccessor = [{ sourcePairingId: "prior-pairing", targetPairingId: "source-pairing", receiptId: id("participation"), effectiveAt: at, revision: 2 }];
  tables.SessionPlanExecution = [{ planId: id("plan"), tutorId: "source-tutor", revision: 2, receiptId: id("participation"), assignments: [{ pairingId: "source-pairing", tuteeIds: ["source-tutee"] }] }];
  tables.SessionParticipantExecution = [{ participantId: id("participant"), sourceSurveyIds: ["source-survey"], tuteeId: "source-tutee", revision: 2, receiptId: id("participation") }];
  tables.SessionPlanningRequest = [{ id: id("request"), planId: id("plan"), cohortId: id("cohort"), kind: "RESCHEDULE", scope: "ALL", participantIds: [id("participant")], parentRequestId: null }];
  tables.SessionPlanningOffer = [{ id: id("offer"), requestId: id("request"), sequence: 1 }];
  tables.SessionPlanningResponse = [{ id: id("response"), offerId: id("offer"), actorKey: "tutee:source-tutee" }];
  tables.SessionResponseExecution = [{ responseId: id("response"), userId: "source-user", profileKind: "TUTEE", profileId: "source-tutee", respondedByUserId: "source-user", revision: 2, receiptId: id("participation") }];
  tables.TutorQualification = [{ tutorId: "source-tutor", subjectId: "source-subject", approvedById: "source-admin", status: "APPROVED", createdAt: at }];
  tables.QualificationGrant = [{ tutorId: "source-tutor", sourceSubjectId: "source-subject", subjectId: "variant-subject", grantedAt: at }];
  tables.QualificationTransferGrant = [{ targetTutorId: "source-tutor", sourceTutorId: "old-tutor", sourceSubjectId: "source-subject", subjectId: "variant-subject", approvedById: "source-admin", approvedAt: at, grantedAt: at, receiptId: id("participation"), active: true, revision: 2 }];
  tables.StudentRequestExecutionAssignment = [{ surveyId: "source-survey", pairingId: "source-pairing", tuteeId: "source-tutee", sourceTuteeId: "old-tutee", revision: 2, receiptId: id("participation"), createdAt: at, releasedAt: null }];
  tables.StudentSurvey = [{ id: "source-survey", email: "synthetic@example.invalid", intakeTermId: "source-term", payload: { subjectId: "source-subject" }, currentPayload: null, currentVersion: 0, policyRevision: "synthetic", policySnapshot: {}, submittedAt: at, verificationAttempts: 0, emailCodeVersion: 1, expiresAt: at, confirmedAt: at, publicSignupEmailConfirmedAt: at, state: "OPEN", tuteeId: "source-tutee", firstAssignedAt: at, verificationDueAt: null, editedAt: null, resolvedAt: null, lastLinkSentAt: at, invalidReason: null, invalidatedAt: null, invalidatedById: null, invalidatedByName: null, invalidityVersion: 0 }];
  tables.RecoveryAction = [...tables.RecoveryAction!, { id: id("checkpoint-action"), kind: "DOMAIN_CHECKPOINT", applicationId: null, before: { planId: id("plan") }, after: null, createdAt: at }];
  tables.RecoveryCheckpoint = [{ id: id("checkpoint"), actionId: id("checkpoint-action"), schemaVersion: 1, adapter: "PARTICIPANT_TUTEE", adapterVersion: 1, sourceEntity: "Tutee", sourceId: "source-tutee", capturedById: "source-admin", captureTransactionId: id("transaction"), scope: [{ entity: "SessionPlan", recordId: id("plan") }], createdAt: at }];
  tables.RecoveryEvent = [...tables.RecoveryEvent!, { id: id("checkpoint-event"), actionId: id("checkpoint-action"), transactionId: id("transaction"), kind: "DOMAIN_CHECKPOINT", payload: null, createdAt: at }];
  tables.RecoveryTrackedEntity = [...tables.RecoveryTrackedEntity!, { actionId: id("checkpoint-action"), entity: "SessionPlan", recordId: id("plan") }];
  tables.RecoveryFence = [...tables.RecoveryFence!, { actionId: id("checkpoint-action"), revision: 1 }];
  tables.Notification = [{ id: id("notification"), userId: "source-user", event: "info", context: { draftId: id("draft") }, link: "/synthetic", title: "Synthetic", body: "Synthetic", recoveryWithdrawnAt: at }];
  tables.EmailDelivery = [{ id: id("delivery"), userId: "source-user", recipient: "synthetic@example.invalid", event: "info", context: { draftId: id("draft") }, reminderKey: null, sourceNotificationId: id("notification"), status: "CANCELLED", attemptId: null, attemptStartedAt: null }];
  tables.RecoveryDeliveryEffect = [
    { id: id("effect-old"), actionId: id("action"), eventId: id("event"), notificationId: id("notification"), deliveryId: id("delivery"), createdAt: at },
    { id: id("effect-new"), actionId: id("checkpoint-action"), eventId: id("checkpoint-event"), notificationId: id("notification"), deliveryId: id("delivery"), createdAt: at },
  ];
  tables.RecoveryReceipt = [{ id: id("recovery-receipt"), actionId: id("action"), actorId: "source-admin", clientKey: id("recovery-client"), inputHash: "exact-recovery-input-hash", reason: "Synthetic", channel: "DIRECT", fingerprint: "exact-fingerprint", evidence: { effectId: id("effect-old") }, createdAt: at }];
  tables.RecoveryDeliveryCancellation = [{ effectId: id("effect-old"), recoveryKey: id("recovery-client"), disposition: "STOPPED", createdAt: at }];
  tables.RecoveryDeliveryCoverage = [
    { eventId: id("event"), actionId: id("action"), version: 2, createdAt: at },
    { eventId: id("checkpoint-event"), actionId: id("checkpoint-action"), version: 2, createdAt: at },
  ];
  tables.RecoveryWorkflowDraft = [{ id: id("draft"), actionId: id("checkpoint-action"), sourceSurveyId: "source-survey", sourceTuteeId: "old-tutee", ownerUserId: "source-user", ownerBindingHash: "exact-owner-binding", answers: { subjectId: "source-subject" }, state: "PENDING_OWNER_REVIEW", version: 1, submittedSurveyId: null, consumedAt: null, createdAt: at }];
  return tables;
}

void test("combined identity/recovery aliases retain complete shared-root and execution linkages", () => {
  const expected = canonicalizeParity(combinedFixture("before"));
  compareParity(canonicalizeParity(combinedFixture("after")), expected);
  assert.ok(!JSON.stringify(expected).includes("before-"), "Generated references must resolve in sidecars, nested receipts and scopes");
  assert.equal(expected.tables.RecoveryDeliveryEffect?.length, 2);
  assert.equal(expected.tables.RecoveryDeliveryCancellation?.length, 1);
  for (const reference of JSON.stringify(expected).match(/@alias:[a-f0-9]{64}/g) ?? [])
    assert.ok(Object.hasOwn(expected.semanticAliases, reference));
});

void test("every combined authority/provenance category remains mutation-sensitive", () => {
  const expected = canonicalizeParity(combinedFixture("before"));
  const mutations: [string, string, unknown][] = [
    ["User", "historyAccessRevision", 8], ["User", "recoveryVoidedAt", new Date("2050-02-01")],
    ["Tutor", "historyIdentityRevision", 8], ["Tutee", "personId", "different-person"],
    ["Person", "revision", 8], ["Person", "primaryUserId", "different-user"],
    ["TutorProfileOwnership", "userId", "different-user"], ["StudentProfileOwnership", "revision", 8],
    ["PersonCombineReceipt", "ownershipTransfers", []], ["PersonPartitionReceipt", "sources", []],
    ["PersonHistoryCorrectionReceipt", "after", { readerUserId: "different-user" }],
    ["RetiredHistoryOwnership", "readerUserId", null], ["HistoryRowOwnership", "readerUserId", null],
    ["HistoryRowOwnership", "quarantineUserIds", []], ["HistoryRowOwnership", "sourceUserIds", []],
    ["HistoryRowOwnership", "revision", 8], ["HistoryRowOwnership", "recordId", "different-notification"],
    ["PersonParticipationTransferReceipt", "selection", {}], ["PersonParticipationTransferReceipt", "inputHash", "changed-hash"],
    ["ParticipantConsolidation", "active", false], ["ParticipantConsolidation", "targetId", "different-tutee"],
    ["PairingExecutionSuccessor", "targetPairingId", "different-pairing"],
    ["SessionPlanExecution", "assignments", []], ["SessionPlanExecution", "revision", 8],
    ["SessionParticipantExecution", "sourceSurveyIds", []], ["SessionParticipantExecution", "participantId", "different-participant"],
    ["SessionResponseExecution", "userId", "different-user"], ["SessionResponseExecution", "respondedByUserId", null],
    ["SessionResponseExecution", "receiptId", "different-receipt"],
    ["TutorQualification", "status", "REJECTED"], ["QualificationGrant", "sourceSubjectId", "different-subject"],
    ["TutorQualification", "createdAt", new Date("2050-02-01")],
    ["QualificationTransferGrant", "sourceTutorId", "different-tutor"], ["QualificationTransferGrant", "active", false],
    ["QualificationTransferGrant", "approvedAt", new Date("2050-02-01")],
    ["StudentRequestExecutionAssignment", "sourceTuteeId", "different-tutee"],
    ["StudentRequestExecutionAssignment", "releasedAt", new Date("2050-02-01")],
    ["StudentRequestExecutionAssignment", "revision", 8], ["StudentSurvey", "currentVersion", 8],
    ["RecoveryCheckpoint", "schemaVersion", 0], ["RecoveryCheckpoint", "sourceId", "different-tutee"],
    ["RecoveryCheckpoint", "scope", []], ["RecoveryCheckpoint", "captureTransactionId", "different-transaction"],
    ["RecoveryDeliveryEffect", "actionId", "different-root"], ["RecoveryDeliveryEffect", "eventId", "different-event"],
    ["RecoveryDeliveryEffect", "deliveryId", "different-delivery"],
    ["RecoveryDeliveryCancellation", "effectId", "after-effect-new-generated"],
    ["RecoveryDeliveryCancellation", "recoveryKey", "different-recovery"], ["RecoveryDeliveryCancellation", "disposition", "IN_FLIGHT_OR_UNKNOWN"],
    ["RecoveryDeliveryCoverage", "version", 0], ["RecoveryDeliveryCoverage", "actionId", "different-root"],
    ["RecoveryWorkflowDraft", "ownerBindingHash", "changed-binding"], ["RecoveryWorkflowDraft", "ownerUserId", "different-user"],
    ["RecoveryWorkflowDraft", "answers", {}], ["RecoveryWorkflowDraft", "version", 8],
    ["RecoveryWorkflowDraft", "submittedSurveyId", "different-survey"],
    ["Notification", "recoveryWithdrawnAt", null], ["EmailDelivery", "sourceNotificationId", null],
  ];
  for (const [table, field, value] of mutations) {
    const actual = combinedFixture("after");
    actual[table]![0]![field] = value;
    assert.throws(() => compareParity(canonicalizeParity(actual), expected), `${table}.${field} must remain evidence`);
  }
  const missingSharedRoot = combinedFixture("after");
  missingSharedRoot.RecoveryDeliveryEffect = missingSharedRoot.RecoveryDeliveryEffect!.slice(0, 1);
  assert.throws(() => compareParity(canonicalizeParity(missingSharedRoot), expected));
  const baselineWithoutSidecars = fixture("before");
  assert.throws(() => compareParity(canonicalizeParity(baselineWithoutSidecars), expected),
    "New candidate evidence is not silently erased to force historical-baseline parity");
});

void test("capture explicitly selects every combined sidecar field inside its coherent snapshot", async () => {
  const source = combinedFixture("capture");
  const explicitTables = [
    "Person", "PersonCombineReceipt", "PersonPartitionReceipt", "RetiredHistoryOwnership", "HistoryRowOwnership",
    "PersonHistoryCorrectionReceipt", "PersonParticipationTransferReceipt", "ParticipantConsolidation",
    "PairingExecutionSuccessor", "SessionPlanExecution", "SessionParticipantExecution", "SessionResponseExecution",
    "TutorQualification", "QualificationGrant", "QualificationTransferGrant", "StudentRequestExecutionAssignment",
    "StudentSurvey", "RecoveryCheckpoint", "RecoveryDeliveryEffect", "RecoveryDeliveryCancellation",
    "RecoveryDeliveryCoverage", "RecoveryWorkflowDraft",
  ];
  const tableByDelegate = new Map(Object.keys(source).map((table) => [table.charAt(0).toLowerCase() + table.slice(1), table]));
  const capturedSource: Record<string, Record<string, unknown>[]> = {};
  const selected = new Set<string>();
  let open = false;
  const tx = new Proxy({}, {
    get: (_target, property) => {
      assert.equal(typeof property, "string");
      const delegate = property as string;
      return { findMany: (args?: { select?: Record<string, boolean> }) => {
        assert.equal(open, true);
        const table = tableByDelegate.get(delegate) ?? delegate.charAt(0).toUpperCase() + delegate.slice(1);
        const values = source[table] ?? [];
        capturedSource[table] = [...values];
        if (explicitTables.includes(table)) {
          assert.ok(args?.select, `${table} requires a positive projection`);
          for (const field of Object.keys(values[0]!)) assert.equal(args.select[field], true, `${table}.${field} omitted`);
          selected.add(table);
        }
        if (table === "StudentSurvey") assert.ok(!args?.select?.tokenHash);
        if (table === "User") assert.ok(!args?.select?.passwordHash);
        return Promise.resolve(args?.select
          ? values.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => args.select![field])))
          : values);
      } };
    },
  });
  const db = { $transaction: async (work: (client: unknown) => Promise<unknown>) => {
    open = true;
    try { return await work(tx); } finally { open = false; }
  } } as unknown as PrismaClient;
  const actual = await captureParity(db);
  assert.deepEqual([...selected].sort(), [...explicitTables].sort());
  compareParity(actual, canonicalizeParity(capturedSource));
});

void test("native qualification approval time survives even when only its recovery journal remains", () => {
  const journal = (prefix: string, approvedAt: string) => {
    const tables = fixture(prefix);
    tables.RecoveryChange = [...tables.RecoveryChange!, {
      id: 90n, actionId: `${prefix}-action-generated`, eventId: `${prefix}-event-generated`,
      entity: "TutorQualification", operation: "DELETE", changedFields: null,
      recordKey: { tutorId: "source-tutor", subjectId: "source-subject" },
      before: { tutorId: "source-tutor", subjectId: "source-subject", status: "APPROVED", createdAt: approvedAt },
      after: null,
    }];
    return canonicalizeParity(tables);
  };
  const expected = journal("before", "2050-01-01T00:00:00.000Z");
  compareParity(journal("after", "2050-01-01T00:00:00.000Z"), expected);
  assert.throws(() => compareParity(journal("after", "2050-01-02T00:00:00.000Z"), expected));
});

/** Normalization stress fixture only: 205 retained parent links, their offers,
 * three actor responses/notices each, plus ordered recovery evidence. It does
 * not claim that this synthetic chain is a production negotiation workflow. */
function depthFixture(prefix: string): ParityTables {
  const tables = fixture(prefix);
  const planId = `${prefix}-plan-generated`;
  const cohortId = `${prefix}-cohort-generated`;
  const requests: Record<string, unknown>[] = [];
  const offers: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  const changes = [...tables.RecoveryChange!];
  const actors = [
    { actorKey: "tutor:source-tutor", actorUserId: "source-tutor-user" },
    { actorKey: "tutee:source-tutee", actorUserId: "source-user" },
    { actorKey: "tutee:source-other-tutee", actorUserId: "source-other-user" },
  ];
  for (let index = 0; index < 205; index++) {
    const requestId = `${prefix}-request-generated-${index}`;
    const offerId = `${prefix}-offer-generated-${index}`;
    const request = {
      id: requestId, planId, cohortId, kind: "RESCHEDULE", scope: "ALL",
      participantIds: ["source-tutee", "source-other-tutee"],
      status: "PENDING", stage: 1, version: 1, currentOfferId: offerId,
      parentRequestId: index ? `${prefix}-request-generated-${index - 1}` : null,
      rejectionKeys: [], createdAt: new Date(Date.UTC(2050, 0, 1, 0, 0, 0, index)),
    };
    requests.push(request);
    offers.push({
      id: offerId, requestId, sequence: 1, authorKey: actors[0]!.actorKey,
      date: "2050-01-10", startMin: 600, endMin: 645,
      startsAt: new Date("2050-01-10T02:00:00Z"), endsAt: new Date("2050-01-10T02:45:00Z"),
      roomId: null, online: true, cutoffAt: new Date("2050-01-10T02:00:00Z"),
    });
    for (const [person, actor] of actors.entries()) {
      const responseId = `${prefix}-response-generated-${index}-${person}`;
      responses.push({
        id: responseId, offerId, ...actor,
        state: person === 0 ? "ACCEPTED" : "PENDING", acceptedBy: person === 0 ? "AUTHOR" : null,
        deliveredAt: new Date("2050-01-01T00:00:00Z"), deadline: new Date("2050-01-02T00:00:00Z"),
        respondedAt: person === 0 ? new Date("2050-01-01T00:00:00.500Z") : null,
      });
      notices.push({
        id: `${prefix}-notice-generated-${index}-${person}`,
        dedupeKey: `request:${requestId}:offer:${offerId}:response:${responseId}:proposed:${actor.actorKey}`,
        requestId, offerId, responseId, recipientUserId: actor.actorUserId,
        recipientEmail: `synthetic-${person}@example.test`, event: "proposed", status: "PENDING", attempts: 0,
        availableAt: new Date("2050-01-01T00:00:00.500Z"),
        context: { isActionable: true, startsAt: "2050-01-10T02:00:00.000Z", endsAt: "2050-01-10T02:45:00.000Z", timeZone: "Asia/Shanghai" },
      });
    }
    changes.push({
      id: BigInt(20 + index), actionId: `${prefix}-action-generated`, eventId: `${prefix}-event-generated`,
      entity: "SessionPlanningRequest", operation: "INSERT", recordKey: { id: requestId },
      before: null, after: { ...request }, changedFields: null,
    });
  }
  tables.SessionPlanningRequest = requests;
  tables.SessionPlanningOffer = offers;
  tables.SessionPlanningResponse = responses;
  tables.SessionNotice = notices;
  tables.RecoveryChange = changes;
  tables.RecoveryFence![0]!.revision = changes.length;
  return tables;
}

void test("compact alias dictionaries bound 205-parent/615-notice serialization while retaining all evidence", () => {
  const options = { operationWindows: [{ label: "synthetic-phase", before: "2050-01-01T00:00:00Z", after: "2050-01-01T00:00:01Z" }] };
  const before = canonicalizeParity(depthFixture("raw-before"), options);
  const after = canonicalizeParity(depthFixture("raw-after"), options);
  compareParity(after, before);
  assert.equal(before.normalization.version, 3);
  assert.equal(before.tables.SessionPlanningRequest?.length, 205);
  assert.equal(before.tables.SessionPlanningOffer?.length, 205);
  assert.equal(before.tables.SessionPlanningResponse?.length, 615);
  assert.equal(before.tables.SessionNotice?.length, 615);
  assert.equal(before.tables.RecoveryChange?.length, 207);
  assert.ok(before.clockEvidence.length > 0);
  const encoded = JSON.stringify(before);
  assert.ok(Buffer.byteLength(encoded, "utf8") < 8 * 1024 * 1024,
    "Compact references must prevent recursive ancestor strings from growing beyond a small bounded artifact");
  assert.ok(!encoded.includes("raw-before-"), "Generated raw IDs must not enter semantic definitions or rows");
  assert.ok(!encoded.includes("@pending:"), "Internal registration references cannot enter the snapshot");
  assert.ok(encoded.includes("source-pairing"), "Seeded source identity remains exact");
  for (const [reference, semantic] of Object.entries(before.semanticAliases)) {
    assert.equal(reference, `@alias:${createHash("sha256").update(semantic).digest("hex")}`);
    assert.ok(semantic.length < 1024, "Each full identity stores compact parent edges, never expanded ancestors");
  }
  for (const reference of encoded.match(/@alias:[a-f0-9]{64}/g) ?? [])
    assert.ok(Object.hasOwn(before.semanticAliases, reference), "Every compact semantic edge must have a full definition");

  const changedNotice = depthFixture("raw-after");
  changedNotice.SessionNotice![614]!.context = { isActionable: false };
  assert.throws(() => compareParity(canonicalizeParity(changedNotice, options), before));
  const changedLineage = depthFixture("raw-after");
  changedLineage.SessionPlanningRequest![100]!.parentRequestId = "raw-after-request-generated-98";
  assert.throws(() => compareParity(canonicalizeParity(changedLineage, options), before));
  const changedJournal = depthFixture("raw-after");
  changedJournal.RecoveryChange = changedJournal.RecoveryChange!.slice(0, -1);
  assert.throws(() => compareParity(canonicalizeParity(changedJournal, options), before));
  const changedDictionary = structuredClone(before);
  const reference = Object.keys(changedDictionary.semanticAliases)[0]!;
  changedDictionary.semanticAliases[reference] += ":changed";
  assert.throws(() => compareParity(changedDictionary, before));
});

void test("large nested mismatches compare complete evidence with a bounded error instead of an expanded diff", () => {
  const base = canonicalizeParity(fixture("large-mismatch"));
  const payload = "synthetic-evidence:" + "x".repeat(2 * 1024 * 1024);
  const snapshot = (decision: string) => ({
    ...base,
    tables: {
      ...base.tables,
      LargeEvidence: [{ payload, nested: { reviewed: { decision } } }],
    },
  });
  const expected = snapshot("accepted");
  compareParity(snapshot("accepted"), expected);
  const actual = snapshot("rejected");
  assert.equal(actual.tables.LargeEvidence.length, expected.tables.LargeEvidence.length);
  assert.equal(actual.tables.LargeEvidence[0]!.payload.length, expected.tables.LargeEvidence[0]!.payload.length);
  assert.throws(() => compareParity(actual, expected), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Scheduling persisted semantic state differs");
    assert.ok(error.message.length < 256);
    const diagnostic = error as Error & { actual?: unknown; expected?: unknown };
    assert.equal(diagnostic.actual, false);
    assert.equal(diagnostic.expected, true);
    assert.ok(JSON.stringify(error).length < 1024,
      "The failure must not retain the source graphs as diagnostic actual/expected fields");
    return true;
  });
  assert.equal(actual.tables.LargeEvidence[0]!.nested.reviewed.decision, "rejected");
  assert.equal(expected.tables.LargeEvidence[0]!.nested.reviewed.decision, "accepted");
});

void test("late extra-plan dependencies resolve without retaining generated request IDs", () => {
  const snapshot = (prefix: string) => {
    const tables = fixture(prefix);
    const requestId = `${prefix}-extra-request-generated`;
    tables.SessionPlanningRequest = [{
      id: requestId, planId: `${prefix}-plan-generated`, cohortId: `${prefix}-cohort-generated`,
      kind: "EXTRA", scope: "ONE", participantIds: ["source-tutee"], parentRequestId: null,
    }];
    tables.SessionPlan = [...tables.SessionPlan!, {
      ...tables.SessionPlan![0]!, id: `${prefix}-extra-plan-generated`, kind: "EXTRA", generationKey: `extra:${requestId}`,
    }];
    return canonicalizeParity(tables);
  };
  const before = snapshot("raw-before");
  compareParity(snapshot("raw-after"), before);
  assert.ok(!JSON.stringify(before).includes("raw-before-"));
});

void test("cyclic generated identity definitions fail closed", () => {
  const tables = fixture("cycle");
  const requestId = "cycle-request-generated";
  tables.SessionPlanningRequest = [{
    id: requestId, planId: "cycle-plan-generated", cohortId: "cycle-cohort-generated",
    kind: "RESCHEDULE", scope: "ALL", participantIds: ["source-tutee"], parentRequestId: requestId,
  }];
  assert.throws(() => canonicalizeParity(tables), /Cyclic generated-alias semantic identity/);
});

void test("source indexes retain duplicate participants and assignment evidence", () => {
  const tables = fixture("duplicates");
  tables.SessionPlanParticipant = [...tables.SessionPlanParticipant!, { ...tables.SessionPlanParticipant![0]! }];
  tables.SessionPlanAssignment = [...tables.SessionPlanAssignment!, { ...tables.SessionPlanAssignment![0]! }];
  const snapshot = canonicalizeParity(tables);
  assert.equal(snapshot.tables.SessionPlanParticipant?.length, 2);
  assert.equal(snapshot.tables.SessionPlanAssignment?.length, 2);
  assert.equal(snapshot.continuationProvenance.length, 1);
  const plan = snapshot.tables.SessionPlan?.[0];
  assert.ok(plan && typeof plan === "object" && !Array.isArray(plan));
  const expectedCohortId = `SessionPlanCohort:${JSON.stringify([
    plan.id,
    "2050-01-10", 600, 645, null, false, false, "SCHEDULED",
    ["source-tutee", "source-tutee"],
  ])}`;
  const cohort = snapshot.tables.SessionPlanCohort?.[0];
  assert.ok(cohort && typeof cohort === "object" && !Array.isArray(cohort));
  assert.ok(typeof cohort.id === "string");
  assert.equal(snapshot.semanticAliases[cohort.id], expectedCohortId);
});

void test("capture normalizes only after its coherent read transaction commits", async () => {
  const tables = fixture("capture");
  let transactionOpen = false;
  let committed = false;
  let normalizationReads = 0;
  const queries = new Set<string>();
  Object.defineProperty(tables.SessionPlanCohort![0]!, "status", {
    enumerable: true,
    get: () => {
      assert.equal(transactionOpen, false, "Pure normalization must not hold the read transaction open");
      assert.equal(committed, true);
      normalizationReads++;
      return "SCHEDULED";
    },
  });
  const delegates = new Map(Object.entries(tables).map(([table, rows]) => [
    table.charAt(0).toLowerCase() + table.slice(1), rows,
  ]));
  const transaction = new Proxy({}, {
    get: (_target, name) => typeof name === "string" ? {
      findMany: () => {
        assert.equal(transactionOpen, true, "Every database read shares the transaction snapshot");
        queries.add(name);
        return Promise.resolve(delegates.get(name) ?? []);
      },
    } : undefined,
  });
  const client = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead", timeout: 120_000 });
      transactionOpen = true;
      try {
        const rows = await work(transaction);
        committed = true;
        return rows;
      } finally { transactionOpen = false; }
    },
  } as unknown as PrismaClient;
  const snapshot = await captureParity(client);
  assert.ok(normalizationReads > 0);
  assert.equal(snapshot.tables.SessionPlan?.length, 1);
  for (const delegate of ["sessionPlan", "sessionPlanParticipant", "sessionNotice", "recoveryChange", "recoveryFence"])
    assert.ok(queries.has(delegate));
});

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
