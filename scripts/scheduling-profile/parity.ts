import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "../../generated/prisma";

type Row = Record<string, unknown>;
export type ParityTables = Record<string, readonly Row[]>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type ParityCaptureSchema = "shared" | "native-original";

/** Reduced evidence is permitted only for the separately reported pristine cold
 * control. It can never authorize a paired baseline/candidate comparison. */
export function selectParityCaptureSchema(
  value: string | undefined,
  context: { scenario: string; mode: string; transport: string; compare: boolean },
): ParityCaptureSchema {
  const schema = value ?? "shared";
  assert.ok(schema === "shared" || schema === "native-original", "Unknown parity capture schema");
  if (schema === "native-original") {
    assert.ok(context.scenario === "cold" && context.mode === "latency" && context.transport === "http" && !context.compare,
      "Native-original capture is only an unpaired cold HTTP latency control");
  }
  return schema;
}

export type ParityOptions = {
  /** Explicit reduced native control; omitted means complete shared-schema capture. */
  captureSchema?: ParityCaptureSchema;
  /** Fixture source IDs are never reinterpreted as operation-created rows. */
  seededPairingIds?: readonly string[];
  /** The actual creation call/result binds generated pairing identity to its
   * committed retry receipt. Creation retries need only the original witness. */
  pairingCreations?: readonly {
    actorId: string;
    clientKey: string;
    input: unknown;
    resultId: string;
  }[];
  /** Raw results of public procedures, captured outside the comparison. Their
   * generated references use the same alias map as the persisted evidence. */
  procedureResults?: readonly { label: string; result: unknown }[];
  /** Measured around actual handlers; never changes the process clock or rows. */
  operationWindows?: readonly {
    label: string;
    before: string;
    after: string;
  }[];
  /** Exact input passed to receipt(), including its operation prefix. A supplied
   * witness must match the stored SHA256 before its generated IDs are normalized.
   * Missing witnesses leave the opaque hash intact and comparison fails closed.
   */
  receiptInputs?: readonly {
    actorId: string;
    clientKey: string;
    input: unknown;
  }[];
};

export const PARITY_NORMALIZATION = {
  version: 3,
  omitted: [
    "createdAt/updatedAt persistence metadata (including journal snapshots), except native qualification approval time",
    "RecoveryChange numeric sequence gaps; per-root change order remains",
    "RecoveryEvent transaction numbers; cross-root transaction grouping remains",
  ],
  preserved: [
    "Selected scalar/JSON content within the declared captureSchema after the listed identity and clock normalization; array order and duplicate rows remain",
    "Room/group versions, shortages, notice state, consent and exact domain clocks",
    "Continuation assignedAt/joinedAt/releasedAt and its relation to plan creation",
    "Recovery event/change order, changedFields, parent references and fences",
    "Identity ownership/execution revisions, immutable receipts, qualification provenance (including native approval time) and exact source/release edges",
    "Checkpoint scopes/capture transactions, shared delivery roots, cancellations, coverage and workflow owner bindings",
    "Opaque hashes unless the complete original receipt input is verified",
    "Seeded pairing IDs stay exact; created pairing aliases require verified input, actor/client receipt and returned identity",
    "Compact SHA256 alias references retain their complete semantic definitions in semanticAliases, including all parent references",
  ],
  operationClocks:
    "Only allowlisted event instants inside an explicitly recorded operation window normalize; their ordering/equality and relation to every fixed domain boundary remain.",
  limits:
    "Exact createdAt/updatedAt bytes are not compared, including inside journal snapshots and procedure results, except TutorQualification.createdAt retained as qualificationApprovedAt. Continuation creation boundaries have a separate witness; sweep selection/rotation needs explicit workload witnesses. Shared-schema capture requires every selected identity/recovery sidecar; feature-only differences require separate candidate evidence. Explicit native-original capture uses only the fixed original-schema projection and cannot establish shared-schema domain parity. This is normalized semantic parity, not byte-identical full journals.",
} as const;

export type ParitySnapshot = {
  captureSchema: ParityCaptureSchema;
  normalization: typeof PARITY_NORMALIZATION;
  semanticAliases: Record<string, string>;
  tables: Record<string, Json[]>;
  continuationProvenance: Json[];
  clockEvidence: Json[];
};

const metadata = new Set(["createdAt", "updatedAt"]);
const eventClocks = new Set([
  "availableAt",
  "respondedAt",
  "usedAt",
  "acceptedAt",
  "completedAt",
  "attemptStartedAt",
]);
const boundaryClocks = new Set([
  "startsAt",
  "endsAt",
  "cutoffAt",
  "deadline",
  "deliveredAt",
  "assignedAt",
  "joinedAt",
  "releasedAt",
]);
const sign = (value: number) => (value < 0 ? -1 : value > 0 ? 1 : 0);
const text = (value: unknown): string => {
  assert.equal(typeof value, "string", "Semantic identity requires a string");
  return value as string;
};
const object = (value: unknown): Row | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
const instant = (value: unknown): number | undefined => {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value))
    return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
};
/** Serialize each sort key once. Native stable sorting retains the original
 * order of equal keys, exactly as the previous JSON comparator did. */
const sortByJson = <T extends Json>(rows: T[]): T[] => rows
  .map((value) => ({ value, key: JSON.stringify(value) }))
  .sort((left, right) => left.key.localeCompare(right.key))
  .map(({ value }) => value);

type AliasTrieNode = {
  children: Map<string, AliasTrieNode>;
  rawId?: string;
};

/** Incremental literal matcher for the existing escaped, longest-first /g
 * replacement. UTF-16 positions and deepest terminals reproduce its leftmost,
 * longest matching without rebuilding a growing regular expression. Replacement
 * text is appended once and never rescanned. Short IDs remain exact-only.
 * Exported so pure tests can compare every insertion with the original oracle.
 */
export function createParityAliasRewriter() {
  const aliases = new Map<string, string>();
  const root: AliasTrieNode = { children: new Map() };
  return {
    get: (rawId: string) => aliases.get(rawId),
    add: (rawId: string, alias: string) => {
      const existed = aliases.has(rawId);
      aliases.set(rawId, alias);
      if (existed || rawId.length < 8) return;
      let node = root;
      for (let index = 0; index < rawId.length; index++) {
        const character = rawId.charAt(index);
        let child = node.children.get(character);
        if (!child) {
          child = { children: new Map() };
          node.children.set(character, child);
        }
        node = child;
      }
      node.rawId = rawId;
    },
    replace: (value: string) => {
      const exact = aliases.get(value);
      if (exact) return exact;
      let output = "";
      let copiedThrough = 0;
      let position = 0;
      while (position < value.length) {
        let node = root;
        let cursor = position;
        let matchedId: string | undefined;
        let matchedEnd = position;
        while (cursor < value.length) {
          const child = node.children.get(value.charAt(cursor));
          if (!child) break;
          node = child;
          cursor++;
          if (node.rawId !== undefined) {
            matchedId = node.rawId;
            matchedEnd = cursor;
          }
        }
        if (matchedId !== undefined) {
          output += value.slice(copiedThrough, position) + aliases.get(matchedId)!;
          position = matchedEnd;
          copiedThrough = position;
        } else position++;
      }
      return copiedThrough ? output + value.slice(copiedThrough) : value;
    },
  };
}

/** Index source rows without deduplicating or reordering their evidence. */
function rowsByField(rows: readonly Row[], field: string) {
  const index = new Map<unknown, Row[]>();
  for (const row of rows) {
    const key = row[field];
    const group = index.get(key);
    if (group) group.push(row);
    else index.set(key, [row]);
  }
  return index;
}
const orderedId = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  return assert.fail("A parity row identity must be a scalar");
};
const chronological = (left: Row, right: Row) =>
  (instant(left.createdAt) ?? 0) - (instant(right.createdAt) ?? 0) ||
  orderedId(left.id).localeCompare(orderedId(right.id));

/** Pure normalizer, also used by synthetic node:test cases. It rejects ambiguous
 * semantic IDs instead of silently merging distinct physical rows. Query-result
 * row order is irrelevant except explicitly ordered audit/recovery histories;
 * arrays stored inside a row remain in their original order.
 */
export function canonicalizeParity(
  input: ParityTables,
  options: ParityOptions = {},
): ParitySnapshot {
  const source: ParityTables = { ...input };
  if (options.procedureResults) {
    assert.ok(!source.ProcedureResult, "ProcedureResult is reserved for captured results");
    assert.equal(new Set(options.procedureResults.map((row) => row.label)).size,
      options.procedureResults.length, "Procedure result labels must be unique");
    source.ProcedureResult = options.procedureResults.map(({ label, result }) => ({ id: label, result }));
  }
  const rows = (table: string) => source[table] ?? [];
  const rewriter = createParityAliasRewriter();
  const semanticIds = new Map<string, string>();
  const semanticDefinitions = new Map<string, string>();
  const rawAliases = new Map<string, string>();
  const addAlias = (raw: unknown, key: string) => {
    const id = text(raw);
    // Internal references keep identity construction bounded even for a long
    // chain of parent requests. They never enter the returned snapshot.
    const reference = `@pending:${createHash("sha256").update(key).digest("hex")}`;
    const previous = rewriter.get(id);
    assert.ok(!previous || previous === reference, `Conflicting alias for ${id}`);
    const owner = semanticIds.get(key);
    assert.ok(!owner || owner === id, `Ambiguous semantic identity: ${key}`);
    const definition = semanticDefinitions.get(reference);
    assert.ok(definition === undefined || definition === key, "Compact alias SHA256 collision");
    rewriter.add(id, reference);
    semanticIds.set(key, id);
    semanticDefinitions.set(reference, key);
    rawAliases.set(id, reference);
  };
  // Source fixture IDs remain exact. Only identities generated by the exercised
  // domain operations receive aliases; changing a source target cannot disappear.
  const replaceString = (value: string) => rewriter.replace(value);
  const participantsByCohort = rowsByField(rows("SessionPlanParticipant"), "cohortId");
  const assignmentsByPlan = rowsByField(rows("SessionPlanAssignment"), "planId");
  const windows = (options.operationWindows ?? []).map((window) => {
    const before = instant(window.before);
    const after = instant(window.after);
    assert.ok(before !== undefined && after !== undefined && before <= after);
    assert.ok(after - before <= 120_000, "Operation clock window exceeds 120s");
    return { label: window.label, before, after };
  });
  assert.equal(new Set(windows.map((window) => window.label)).size, windows.length);
  // Overlapping concurrent calls cannot provide an unambiguous clock witness.
  // Such snapshots keep exact timestamps until the harness supplies a single
  // explicitly labelled batch window for the concurrent operation.
  const clockWindow = (time: number) => {
    const matches = windows.filter((window) =>
      time >= window.before && time <= window.after,
    );
    assert.ok(matches.length <= 1, "Overlapping operation clock witnesses");
    return matches[0];
  };
  const normalize = (value: unknown, key = "", clocks = true): Json => {
    if (value === null || value === undefined) return null;
    if (typeof value === "bigint") return value.toString();
    const time = instant(value);
    if (time !== undefined && eventClocks.has(key) && clocks) {
      const window = clockWindow(time);
      if (window) return { operationClock: window.label };
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return replaceString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, key, clocks));
    const record = object(value);
    assert.ok(record, `Unsupported parity value at ${key}`);
    return Object.fromEntries(
      Object.entries(record)
        .filter(([field]) => !metadata.has(field))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, entry]) => [field, normalize(entry, field, clocks)]),
    );
  };
  const key = (...parts: unknown[]) => JSON.stringify(normalize(parts, "", false));
  const register = (table: string, identity: (row: Row) => string) => {
    for (const row of rows(table)) addAlias(row.id, `${table}:${identity(row)}`);
  };
  const seededPairingIds = new Set(options.seededPairingIds ?? []);
  assert.equal(seededPairingIds.size, options.seededPairingIds?.length ?? 0);
  const witnessedCreations = new Set<string>();
  const creationOccurrences = new Map<string, number>();
  for (const witness of options.pairingCreations ?? []) {
    const receiptKey = `${witness.actorId}\0${witness.clientKey}`;
    assert.ok(!witnessedCreations.has(receiptKey), "Duplicate pairing creation witness");
    witnessedCreations.add(receiptKey);
    const receipts = rows("PairingCreationRequest").filter((row) =>
      row.actorId === witness.actorId && row.clientKey === witness.clientKey,
    );
    assert.equal(receipts.length, 1, "Pairing creation needs its exact committed actor/client receipt");
    const receipt = receipts[0]!;
    assert.equal(receipt.pairingId, witness.resultId, "Pairing receipt differs from the authoritative procedure result");
    assert.ok(!seededPairingIds.has(witness.resultId), "A pairing creation cannot alias a seeded source ID");
    assert.equal(rows("Pairing").filter((row) => row.id === witness.resultId).length, 1,
      "The witnessed created pairing must exist exactly once");
    const intent = object(witness.input);
    assert.ok(intent, "Pairing creation requires the original input object");
    assert.equal(intent.clientKey, witness.clientKey, "Creation input belongs to another client key");
    const tuteeIds = intent.tuteeIds;
    assert.ok(Array.isArray(tuteeIds) && tuteeIds.every((id) => typeof id === "string"));
    const roomMode = intent.roomMode ?? (intent.roomId ? "FIXED" : "AUTO");
    assert.ok(["AUTO", "FIXED", "NONE"].includes(text(roomMode)));
    // Mirror pairingCreationHash's documented semantic shape without importing
    // application modules or qualification-ticket/credential state into profiling.
    const semanticInput = {
      tutorId: text(intent.tutorId), subject: text(intent.subject),
      subjectId: intent.subjectId ?? null, timeSlotId: text(intent.timeSlotId),
      roomMode, roomId: roomMode === "FIXED" ? (intent.roomId ?? null) : null,
      tuteeIds: [...new Set(tuteeIds)].sort(),
    };
    const digest = createHash("sha256").update(JSON.stringify(semanticInput)).digest("hex");
    assert.equal(receipt.payloadHash, digest, "Pairing creation input does not match its committed receipt hash");
    const identity = key(witness.actorId, digest);
    const occurrence = creationOccurrences.get(identity) ?? 0;
    creationOccurrences.set(identity, occurrence + 1);
    const clientIdentity = `client:PairingCreationRequest:${identity}:${occurrence}`;
    addAlias(witness.clientKey, clientIdentity);
    addAlias(witness.resultId, `Pairing:created:${clientIdentity}`);
  }
  register("StudentContinuationAssignment", (row) => key(row.surveyId, row.sourcePairingId));
  register("SessionPlan", (row) => replaceString(text(row.generationKey)));
  register("SessionPlanCohort", (row) => key(
    row.planId, row.date, row.startMin, row.endMin, row.roomId, row.online,
    row.rescheduled, row.status,
    (participantsByCohort.get(row.id) ?? [])
      .map((person) => text(person.tuteeId)).sort(),
  ));
  register("SessionPlanParticipant", (row) => key(row.planId, row.tuteeId));
  // Sequential logical requests can share a target. Preserve their occurrence
  // order, rather than using mutable currentOfferId/version as identity.
  const registerOccurrences = (table: string, identity: (row: Row) => string) => {
    const occurrences = new Map<string, number>();
    for (const row of [...rows(table)].sort(chronological)) {
      const base = identity(row);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      addAlias(row.id, `${table}:${base}:${occurrence}`);
    }
  };
  // Parents always precede children in the persisted workflow. Register in
  // creation order so parent references normalize before their child key.
  registerOccurrences("SessionPlanningRequest", (row) => key(
    row.planId, row.cohortId, row.kind, row.scope, row.participantIds, row.parentRequestId,
  ));
  register("SessionPlanningOffer", (row) => key(row.requestId, row.sequence));
  register("SessionPlanningResponse", (row) => key(row.offerId, row.actorKey));
  registerOccurrences("SessionPlanningSuggestion", (row) => key(
    row.planId, row.cohortId, row.tuteeId, row.sourceVersion,
    row.date, row.startMin, row.roomId, row.online,
  ));
  register("Session", (row) => key(row.pairingId, row.planningCohortId, row.date));
  registerOccurrences("DisciplinaryCard", (row) => key(row.sessionId, row.tuteeId, row.color, row.source));
  register("SessionFlag", (row) => key(row.sessionId));
  registerOccurrences("ServiceHourAdjustment", (row) => key(
    row.tutorId, row.month, row.schoolYear, row.quarter, row.type, row.amount, row.reason,
  ));
  // Receipt IDs are operation identities. Keep the opaque input hash exact;
  // without a verified original input, differing hashes are real incompatibility.
  for (const table of ["PersonCombineReceipt", "PersonPartitionReceipt",
    "PersonHistoryCorrectionReceipt", "PersonParticipationTransferReceipt"])
    registerOccurrences(table, (row) => key(row.actorId, row.inputHash));
  // Only partition has an immutable, explicit new-Person creation witness.
  // Other Person/profile/survey source IDs remain exact, including empty groups.
  for (const row of rows("PersonPartitionReceipt"))
    addAlias(row.newPersonId, `Person:partition:${key(row.id)}`);
  const checkpointsByAction = rowsByField(rows("RecoveryCheckpoint"), "actionId");
  registerOccurrences("RecoveryAction", (row) => {
    const checkpoints = checkpointsByAction.get(row.id) ?? [];
    assert.ok(checkpoints.length <= 1, "Recovery action has multiple checkpoints");
    const checkpoint = checkpoints[0];
    return checkpoint
      ? key(row.kind, row.applicationId, checkpoint.adapter, checkpoint.adapterVersion,
        checkpoint.sourceEntity, checkpoint.sourceId, checkpoint.capturedById)
      : key(row.kind, row.applicationId);
  });
  register("RecoveryCheckpoint", (row) => key(row.actionId));
  register("RecoveryWorkflowDraft", (row) => key(row.actionId, row.sourceSurveyId));

  const orderedChanges = [...rows("RecoveryChange")].sort((a, b) => {
    const left = BigInt(a.id as string | number | bigint);
    const right = BigInt(b.id as string | number | bigint);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const changePositions = new Map<Row, number>();
  const counts = new Map<string, number>();
  const eventOrder = new Map<string, number>();
  for (const change of orderedChanges) {
    const action = text(change.actionId);
    const position = counts.get(action) ?? 0;
    counts.set(action, position + 1);
    changePositions.set(change, position);
    if (!eventOrder.has(text(change.eventId))) eventOrder.set(text(change.eventId), position);
  }
  const eventCounts = new Map<string, number>();
  for (const event of [...rows("RecoveryEvent")].sort((a, b) =>
    replaceString(text(a.actionId)).localeCompare(replaceString(text(b.actionId))) ||
    (eventOrder.get(text(a.id)) ?? Infinity) - (eventOrder.get(text(b.id)) ?? Infinity) ||
    chronological(a, b),
  )) {
    const action = text(event.actionId);
    const position = eventCounts.get(action) ?? 0;
    eventCounts.set(action, position + 1);
    addAlias(event.id, `RecoveryEvent:${key(action)}:${position}`);
  }
  const transactions = new Map<string, string[]>();
  for (const event of rows("RecoveryEvent")) {
    const transaction = text(event.transactionId);
    const members = transactions.get(transaction) ?? [];
    members.push(replaceString(text(event.id)));
    transactions.set(transaction, members);
  }
  // Capture and journal transactions share one namespace. Preserve whether a
  // checkpoint was captured alongside each event, even for an empty checkpoint.
  for (const checkpoint of rows("RecoveryCheckpoint")) {
    const transaction = text(checkpoint.captureTransactionId);
    const members = transactions.get(transaction) ?? [];
    members.push(replaceString(text(checkpoint.id)));
    transactions.set(transaction, members);
  }
  for (const [transaction, members] of transactions)
    addAlias(transaction, `transaction:${JSON.stringify(members.sort())}`);

  // Client keys are opaque operation identities, not entropy-dependent output.
  // Bind each to its exact actor and normalized immutable result, retaining
  // repeated same-result operations as separate occurrences.
  for (const table of ["SessionPlanningReceipt", "StudentContinuationReceipt", "RecoveryReceipt"]) {
    const occurrences = new Map<string, number>();
    for (const row of [...rows(table)].sort(chronological)) {
      const identity = key(row.actorId ?? row.userId, row.result ?? row.pairingId ?? row.actionId);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      addAlias(row.clientKey, `client:${table}:${identity}:${occurrence}`);
      if (row.id) addAlias(row.id, `${table}:${identity}:${occurrence}`);
    }
  }
  register("SessionNotice", (row) => replaceString(text(row.dedupeKey)));
  registerOccurrences("Notification", (row) => key(row.userId, row.event, row.context, row.link, row.title, row.body));
  registerOccurrences("EmailDelivery", (row) => key(row.userId, row.recipient, row.event, row.context, row.reminderKey));
  register("RecoveryDeliveryEffect", (row) => key(
    row.actionId, row.eventId, row.notificationId, row.deliveryId,
  ));
  registerOccurrences("AuditLog", (row) => key(row.entity, row.entityId, row.operation, row.action, row.userId));

  // Resolve the semantic dependency graph once. Dictionary values contain full
  // identity definitions with compact parent edges, rather than recursively
  // JSON-escaping entire ancestor identities. Late references (for example an
  // extra plan's originating request) resolve without retaining generated IDs.
  const semanticAliases = new Map<string, string>();
  const resolvedReferences = new Map<string, string>();
  const resolving = new Set<string>();
  const resolvedOwners = new Map<string, string>();
  const ownerByReference = new Map([...rawAliases].map(([raw, reference]) => [reference, raw]));
  const pendingPattern = () => /@pending:[a-f0-9]{64}/g;
  const resolveRawSegment = (value: string): string => rewriter.replace(value).replace(
    pendingPattern(), (reference) => semanticDefinitions.has(reference) ? resolveReference(reference) : reference,
  );
  const resolveDefinition = (value: string): string => {
    let result = "";
    let copiedThrough = 0;
    // Protect existing internal references from raw-ID substring replacement;
    // then resolve any late raw references in the remaining literal segments.
    for (const match of value.matchAll(pendingPattern())) {
      if (!semanticDefinitions.has(match[0])) continue;
      result += resolveRawSegment(value.slice(copiedThrough, match.index)) + resolveReference(match[0]);
      copiedThrough = match.index + match[0].length;
    }
    return result + resolveRawSegment(value.slice(copiedThrough));
  };
  function resolveReference(reference: string): string {
    const existing = resolvedReferences.get(reference);
    if (existing) return existing;
    assert.ok(!resolving.has(reference), "Cyclic generated-alias semantic identity");
    const definition = semanticDefinitions.get(reference);
    assert.ok(definition !== undefined, "Missing generated-alias semantic definition");
    resolving.add(reference);
    const semantic = resolveDefinition(definition);
    const compact = `@alias:${createHash("sha256").update(semantic).digest("hex")}`;
    const previous = semanticAliases.get(compact);
    assert.ok(previous === undefined || previous === semantic, "Resolved alias SHA256 collision");
    const raw = ownerByReference.get(reference);
    assert.ok(raw !== undefined);
    const owner = resolvedOwners.get(semantic);
    assert.ok(owner === undefined || owner === raw, `Ambiguous resolved semantic identity: ${semantic}`);
    resolvedOwners.set(semantic, raw);
    semanticAliases.set(compact, semantic);
    resolvedReferences.set(reference, compact);
    resolving.delete(reference);
    return compact;
  }
  for (const reference of semanticDefinitions.keys()) resolveReference(reference);
  // Update only after the complete graph resolves, so every raw lookup during
  // resolution observes the same internal dictionary rather than mixed phases.
  for (const [raw, reference] of rawAliases) rewriter.add(raw, resolvedReferences.get(reference)!);
  for (const semantic of semanticAliases.values())
    assert.equal(rewriter.replace(semantic), semantic, "Unresolved generated ID in semantic alias dictionary");

  const receiptInputs = new Map(
    (options.receiptInputs ?? []).map((witness) => [
      `${witness.actorId}\0${witness.clientKey}`, witness,
    ]),
  );
  assert.equal(receiptInputs.size, options.receiptInputs?.length ?? 0);
  const normalizedHash = (row: Row) => {
    const witness = receiptInputs.get(`${text(row.actorId)}\0${text(row.clientKey)}`);
    if (!witness) return row.payloadHash;
    const digest = createHash("sha256").update(JSON.stringify(witness.input)).digest("hex");
    assert.equal(row.payloadHash, digest, "Receipt input witness does not match stored payloadHash");
    return { verifiedInput: normalize(witness.input) };
  };
  const tables: Record<string, Json[]> = {};
  // This field is native approval evidence, not ordinary persistence metadata:
  // a transferred grant must retain the original approval's exact instant.
  const qualificationEvidence = (value: unknown) => {
    const row = object(value);
    return row && Object.hasOwn(row, "createdAt")
      ? { ...row, qualificationApprovedAt: row.createdAt }
      : value;
  };
  for (const [table, values] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    const mapped = values.map((row) => {
      const copy = { ...row };
      if (table === "SessionPlanningReceipt") copy.payloadHash = normalizedHash(row);
      if (table === "TutorQualification") return normalize(qualificationEvidence(copy));
      if (table === "RecoveryChange") {
        copy.id = `change:${key(row.actionId)}:${changePositions.get(row)!}`;
        if (row.entity === "TutorQualification") {
          copy.before = qualificationEvidence(row.before);
          copy.after = qualificationEvidence(row.after);
        }
      }
      return normalize(copy);
    });
    // Audit order is meaningful within its captured global history. Recovery
    // changes carry each root's explicit ordinal, preserving away-and-back edits.
    tables[table] = table === "AuditLog"
      ? [...values].sort(chronological).map((row) => normalize(row))
      : sortByJson(mapped);
  }

  const continuationProvenance: Json[] = [];
  for (const plan of rows("SessionPlan")) {
    const createdAt = instant(plan.createdAt);
    assert.ok(createdAt !== undefined, "Plan creation is required for provenance");
    const assignments = assignmentsByPlan.get(plan.id) ?? [];
    const pairingIds = new Set(assignments.map((row) => row.pairingId));
    for (const assignment of rows("StudentContinuationAssignment")) {
      if (!pairingIds.has(assignment.targetPairingId)) continue;
      const assignedAt = instant(assignment.assignedAt);
      continuationProvenance.push(normalize({
        planId: plan.id,
        assignmentId: assignment.id,
        assignedRelativeToPublication: assignedAt === undefined ? null : sign(assignedAt - createdAt),
        countsAsPostPublicationAddition:
          assignment.status === "ASSIGNED" && assignedAt !== undefined && assignedAt > createdAt,
      }));
    }
  }

  // Keep domain-boundary relations for every normalized operation instant. This
  // prevents millisecond tolerance from hiding exact-start/cutoff/deadline flips.
  const fixedBoundaries = new Map<number, string[]>();
  const dynamic = new Map<number, { label: string; paths: string[] }>();
  const visit = (value: unknown, path: string, field = "") => {
    if (metadata.has(field)) return;
    const time = instant(value);
    if (time !== undefined) {
      if (boundaryClocks.has(field)) {
        const paths = fixedBoundaries.get(time) ?? [];
        paths.push(path);
        fixedBoundaries.set(time, paths);
      }
      if (eventClocks.has(field)) {
        const window = clockWindow(time);
        if (window) {
          const evidence = dynamic.get(time) ?? { label: window.label, paths: [] };
          evidence.paths.push(path);
          dynamic.set(time, evidence);
        }
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`, field));
    else if (object(value))
      for (const [name, entry] of Object.entries(value as Row)) visit(entry, `${path}.${name}`, name);
  };
  for (const [table, values] of Object.entries(source))
    for (const row of values) {
      const identity = table === "RecoveryChange"
        ? `change:${key(row.actionId)}:${changePositions.get(row)!}`
        : row.id ? replaceString(text(row.id)) : key(normalize(row));
      visit(row, `${table}:${identity}`);
    }
  const clockEvidence = [...dynamic.entries()].sort(([a], [b]) => a - b).map(([time, evidence]) => ({
    operation: evidence.label,
    paths: evidence.paths.sort(),
    boundaries: [...fixedBoundaries.entries()].sort(([a], [b]) => a - b).map(([boundary, paths]) => ({
      at: new Date(boundary).toISOString(),
      paths: paths.sort(),
      relation: sign(time - boundary),
    })),
  }));
  return {
    captureSchema: options.captureSchema ?? "shared",
    normalization: PARITY_NORMALIZATION,
    semanticAliases: Object.fromEntries([...semanticAliases].sort(([left], [right]) => left.localeCompare(right))),
    tables,
    continuationProvenance: sortByJson(continuationProvenance),
    clockEvidence,
  };
}

/** Fixed c113b8ef original-schema projection for the separately labelled cold
 * control. No runtime schema discovery, missing-table fallback, or new sidecars.
 * Positive selections also prevent a newer generated client from silently
 * broadening this reduced contract. Shared capture below remains complete. */
async function captureNativeOriginalTables(tx: Prisma.TransactionClient) {
  const tables: Record<string, Row[]> = {};
  tables.ProgramSettings = await tx.programSettings.findMany({ select: {
    captchaEnabled: true, captchaVersion: true, signupFields: true, nameFields: true, nameFieldsVersion: true, requireLatinNames: true,
    requireLatinLegalNames: true, usePreferredNames: true, showAlternateNames: true, offeredGrades: true, emailNotificationsEnabled: true, secondaryEmailBindingEnabled: true,
    id: true, timeZone: true, updatedAt: true,
  } });
  tables.ProgramFeature = await tx.programFeature.findMany({ select: {
    key: true, enabled: true, pendingEnabled: true, revision: true, updatedByName: true, updatedAt: true,
  } });
  tables.Term = await tx.term.findMany({ select: {
    id: true, schoolYear: true, quarter: true, name: true, startDate: true, endDate: true,
    signupOpensAt: true, signupEnabled: true, signupClosesAt: true, signupOpeningStateSince: true, signupFirstOpenedAt: true, continuationSourceTermId: true,
    continuationQuarterTransition: true, tutorSignupEnabled: true, tutorSignupOpensAt: true, tutorSignupClosesAt: true, tutorSignupPreviewUrl: true, signupPreviewUrl: true,
    active: true, nextRecruitmentRevision: true, createdAt: true,
  } });
  tables.TimeSlot = await tx.timeSlot.findMany({ select: {
    id: true, label: true, dayOfWeek: true, startMin: true, endMin: true, active: true,
    createdAt: true,
  } });
  tables.SchoolCalendarDay = await tx.schoolCalendarDay.findMany({ select: {
    date: true, isSchoolDay: true, timetableWeekday: true, note: true, active: true, version: true,
    scheduleRevision: true, updatedAt: true,
  } });
  tables.Room = await tx.room.findMany({ select: {
    id: true, name: true, programOrder: true, patrolOrder: true, createdAt: true,
  } });
  tables.RoomUnavailability = await tx.roomUnavailability.findMany({ select: {
    id: true, roomId: true, dayOfWeek: true, startMin: true, endMin: true, reason: true,
    createdAt: true,
  } });
  tables.Pairing = await tx.pairing.findMany({ select: {
    roomMode: true, roomNeedsAssignment: true, roomVersion: true, roomShortageKey: true, groupId: true, scheduleConfirmed: true,
    id: true, subject: true, dayOfWeek: true, startMin: true, endMin: true, createdAt: true,
    tutorId: true, termId: true, roomId: true, timeSlotId: true,
  } });
  tables.PairingGroup = await tx.pairingGroup.findMany({ select: {
    id: true, tutorId: true, termId: true, primaryPairingId: true, createdAt: true, updatedAt: true,
  } });
  tables.PairingTutee = await tx.pairingTutee.findMany({ select: {
    pairingId: true, tuteeId: true,
  } });
  tables.PairingCreationRequest = await tx.pairingCreationRequest.findMany({ select: {
    actorId: true, clientKey: true, payloadHash: true, pairingId: true, createdAt: true,
  } });
  tables.User = await tx.user.findMany({ select: {
    personId: true, studentId: true, id: true, profileVersion: true, sessionVersion: true, recoveryVoidedAt: true,
    mergedIntoId: true, role: true, tutorAccessRevoked: true, suspendedAt: true, tutorId: true,
  } });
  tables.Tutor = await tx.tutor.findMany({ select: {
    historyIdentityRevision: true, personId: true, id: true, status: true,
  } });
  tables.Tutee = await tx.tutee.findMany({ select: {
    historyIdentityRevision: true, personId: true, id: true, status: true,
  } });
  tables.TutorProfileOwnership = await tx.tutorProfileOwnership.findMany({ select: {
    tutorId: true, userId: true, revision: true,
  } });
  tables.StudentProfileOwnership = await tx.studentProfileOwnership.findMany({ select: {
    tuteeId: true, userId: true, revision: true,
  } });
  tables.Person = await tx.person.findMany({ select: {
    id: true, revision: true, primaryUserId: true, resolutionState: true, mergedIntoId: true, createdAt: true,
    updatedAt: true,
  } });
  tables.PersonCombineReceipt = await tx.personCombineReceipt.findMany({ select: {
    id: true, actorId: true, inputHash: true, personId: true, outcome: true, retiredUserIds: true,
    createdAt: true,
  } });
  tables.TutorQualification = await tx.tutorQualification.findMany({ select: {
    tutorId: true, subjectId: true, approvedById: true, status: true, createdAt: true,
  } });
  tables.QualificationGrant = await tx.qualificationGrant.findMany({ select: {
    tutorId: true, sourceSubjectId: true, subjectId: true, grantedAt: true,
  } });
  tables.StudentSurvey = await tx.studentSurvey.findMany({ select: {
    invalidReason: true, invalidatedAt: true, invalidatedById: true, invalidatedByName: true, invalidityVersion: true, id: true,
    email: true, intakeTermId: true, payload: true, currentPayload: true, currentVersion: true, policyRevision: true,
    policySnapshot: true, submittedAt: true, verificationAttempts: true, emailCodeVersion: true, expiresAt: true, confirmedAt: true,
    publicSignupEmailConfirmedAt: true, state: true, tuteeId: true, firstAssignedAt: true, verificationDueAt: true, editedAt: true,
    resolvedAt: true, lastLinkSentAt: true,
  } });
  tables.SchoolDeparture = await tx.schoolDeparture.findMany({ select: {
    userId: true, reason: true, effectiveAt: true, confirmedAt: true, confirmedById: true, source: true,
    revision: true, observerRevoked: true, tutorDerived: true,
  } });
  tables.SessionPlan = await tx.sessionPlan.findMany({ select: {
    id: true, generationKey: true, tutorId: true, termId: true, originalDate: true, timeZone: true,
    kind: true, sourceFingerprint: true, sourceScheduleFingerprint: true, createdAt: true, updatedAt: true,
  } });
  tables.SessionPlanAssignment = await tx.sessionPlanAssignment.findMany({ select: {
    planId: true, pairingId: true, subject: true, tuteeIds: true, primary: true,
  } });
  tables.SessionPlanCohort = await tx.sessionPlanCohort.findMany({ select: {
    id: true, planId: true, date: true, startMin: true, endMin: true, startsAt: true,
    endsAt: true, roomId: true, online: true, rescheduled: true, sourceInvalidated: true, status: true,
    version: true, createdAt: true, updatedAt: true,
  } });
  tables.SessionPlanParticipant = await tx.sessionPlanParticipant.findMany({ select: {
    id: true, planId: true, tuteeId: true, cohortId: true, status: true, scheduleOverride: true,
    calendarSuppressed: true, version: true, updatedAt: true,
  } });
  tables.SessionPlanContinuationMember = await tx.sessionPlanContinuationMember.findMany({ select: {
    planId: true, pairingId: true, tuteeId: true, assignmentId: true, joinedAt: true, releasedAt: true,
  } });
  tables.SessionPlanningSuggestion = await tx.sessionPlanningSuggestion.findMany({ select: {
    id: true, planId: true, cohortId: true, tuteeId: true, actorUserId: true, sourceVersion: true,
    date: true, startMin: true, roomId: true, online: true, version: true, usedAt: true,
    createdAt: true,
  } });
  tables.SessionPlanningRequest = await tx.sessionPlanningRequest.findMany({ select: {
    id: true, planId: true, cohortId: true, kind: true, scope: true, participantIds: true,
    status: true, stage: true, version: true, currentOfferId: true, parentRequestId: true, rejectionKeys: true,
    createdAt: true, updatedAt: true,
  } });
  tables.SessionPlanningOffer = await tx.sessionPlanningOffer.findMany({ select: {
    id: true, requestId: true, sequence: true, authorKey: true, date: true, startMin: true,
    endMin: true, startsAt: true, endsAt: true, roomId: true, online: true, cutoffAt: true,
    createdAt: true,
  } });
  tables.SessionPlanningResponse = await tx.sessionPlanningResponse.findMany({ select: {
    id: true, offerId: true, actorKey: true, actorUserId: true, state: true, acceptedBy: true,
    deliveredAt: true, deadline: true, respondedAt: true,
  } });
  tables.SessionPlanningReceipt = await tx.sessionPlanningReceipt.findMany({ select: {
    actorId: true, clientKey: true, payloadHash: true, result: true, createdAt: true,
  } });
  tables.SessionNotice = await tx.sessionNotice.findMany({ select: {
    id: true, dedupeKey: true, requestId: true, offerId: true, responseId: true, recipientUserId: true,
    recipientEmail: true, event: true, context: true, priority: true, status: true, attempts: true,
    availableAt: true, leaseUntil: true, attemptId: true, attemptStartedAt: true, acceptedAt: true, completedAt: true,
    lastError: true, createdAt: true, updatedAt: true,
  } });
  tables.SessionCalendarToken = await tx.sessionCalendarToken.findMany({ select: {
    id: true, userId: true, createdAt: true, revokedAt: true,
  } });
  assert.equal(tables.SessionCalendarToken.length, 0, "The native profile fixture must not create private calendar capabilities");
  tables.StudentContinuationAssignment = await tx.studentContinuationAssignment.findMany({ select: {
    id: true, surveyId: true, sourcePairingId: true, sourceTuteeId: true, targetTermId: true, targetPairingId: true,
    tuteeId: true, tutorId: true, status: true, reason: true, snapshot: true, createdAt: true,
    assignedAt: true, releasedAt: true,
  } });
  tables.StudentContinuationPairing = await tx.studentContinuationPairing.findMany({ select: {
    sourcePairingId: true, targetTermId: true, pairingId: true, createdAt: true,
  } });
  tables.StudentContinuationReceipt = await tx.studentContinuationReceipt.findMany({ select: {
    userId: true, clientKey: true, inputHash: true, surveyId: true, result: true, createdAt: true,
  } });
  tables.Session = await tx.session.findMany({ select: {
    planningCohortId: true, updatedAt: true, submissionKey: true, submissionPayloadHash: true, id: true, date: true,
    tutorStatus: true, tutorAbsentReason: true, startMin: true, endMin: true, ratingPreparedness: true, ratingParticipation: true,
    ratingUnderstanding: true, ratingBehavior: true, ratingProgress: true, comments: true, month: true, schoolYear: true,
    quarter: true, durationMin: true, shFactor: true, shCount: true, createdAt: true, mergeGroupId: true,
    pairingId: true, timeSlotId: true, tutorId: true, actualRoomId: true, online: true,
  } });
  tables.SessionTutee = await tx.sessionTutee.findMany({ select: {
    sessionId: true, tuteeId: true, status: true, absenceReason: true,
  } });
  tables.SessionFlag = await tx.sessionFlag.findMany({ select: {
    id: true, sessionId: true, tutorId: true, expected: true, observed: true, state: true,
    decisionNote: true, createdAt: true, resolvedAt: true, resolvedById: true, resolvedByName: true,
  } });
  tables.DisciplinaryCard = await tx.disciplinaryCard.findMany({ select: {
    id: true, tuteeId: true, color: true, source: true, reason: true, reviewStatus: true,
    reviewNote: true, reviewedAt: true, reviewedById: true, issuedByTutorId: true, sessionId: true, createdAt: true,
    updatedAt: true,
  } });
  tables.ServiceHourAdjustment = await tx.serviceHourAdjustment.findMany({ select: {
    id: true, month: true, schoolYear: true, quarter: true, type: true, amount: true,
    reason: true, createdAt: true, tutorId: true,
  } });
  tables.AuditLog = await tx.auditLog.findMany({ select: {
    kind: true, operation: true, approvalId: true, details: true, id: true, userId: true,
    userName: true, action: true, entity: true, entityId: true, undoData: true, undone: true,
    undoneAt: true, createdAt: true,
  } });
  tables.Notification = await tx.notification.findMany({ select: {
    id: true, userId: true, title: true, category: true, body: true, event: true,
    context: true, link: true, inAppOnly: true, readAt: true, createdAt: true,
  } });
  tables.EmailDelivery = await tx.emailDelivery.findMany({ select: {
    id: true, reminderKey: true, userId: true, category: true, preferenceTopic: true, event: true,
    context: true, requestKind: true, requestId: true, requestVersion: true, requestInvalid: true, requestReason: true,
    requestSubmittedAt: true, requestTimeZone: true, destination: true, recipient: true, previousPrimary: true, createdAt: true,
    attempts: true, availableAt: true, leaseUntil: true, attemptId: true, attemptStartedAt: true, completedAt: true,
    status: true, lastError: true, monthlyHoursReportId: true, schoolHoursReportId: true,
  } });
  tables.RecoveryAction = await tx.recoveryAction.findMany({ select: {
    id: true, kind: true, applicationId: true, before: true, after: true, createdAt: true,
  } });
  tables.RecoveryEvent = await tx.recoveryEvent.findMany({ select: {
    id: true, actionId: true, transactionId: true, kind: true, payload: true, createdAt: true,
  } });
  tables.RecoveryChange = await tx.recoveryChange.findMany({ orderBy: { id: "asc" }, select: {
    id: true, actionId: true, eventId: true, entity: true, operation: true, changedFields: true,
    recordKey: true, before: true, after: true, createdAt: true,
  } });
  tables.RecoveryTrackedEntity = await tx.recoveryTrackedEntity.findMany({ select: {
    actionId: true, entity: true, recordId: true,
  } });
  tables.RecoveryFence = await tx.recoveryFence.findMany({ select: {
    actionId: true, revision: true,
  } });
  tables.RecoveryReceipt = await tx.recoveryReceipt.findMany({ select: {
    id: true, actionId: true, actorId: true, clientKey: true, inputHash: true, reason: true,
    channel: true, fingerprint: true, evidence: true, createdAt: true,
  } });
  return tables;
}

/** Capture outside timed requests and after competing tasks finish. One
 * repeatable-read transaction prevents the comparison itself from assembling
 * independently committed states. All source data must be synthetic and owned
 * by the harness; credentials are never selected.
 */
export async function captureParity(
  db: PrismaClient,
  options: ParityOptions = {},
): Promise<ParitySnapshot> {
  assert.ok(options.captureSchema === undefined || options.captureSchema === "shared" || options.captureSchema === "native-original", "Unknown parity capture schema");
  const tables = await db.$transaction(async (tx) => {
    if (options.captureSchema === "native-original") return captureNativeOriginalTables(tx);
    const tables: Record<string, Row[]> = {};
    // Explicit delegates make schema additions reviewable; no broad raw-table
    // export and no secrets from User/TutorApplication credential storage.
    tables.ProgramSettings = await tx.programSettings.findMany();
    tables.ProgramFeature = await tx.programFeature.findMany();
    tables.Term = await tx.term.findMany();
    tables.TimeSlot = await tx.timeSlot.findMany();
    tables.SchoolCalendarDay = await tx.schoolCalendarDay.findMany();
    tables.Room = await tx.room.findMany();
    tables.RoomUnavailability = await tx.roomUnavailability.findMany();
    tables.Pairing = await tx.pairing.findMany();
    tables.PairingGroup = await tx.pairingGroup.findMany();
    tables.PairingTutee = await tx.pairingTutee.findMany();
    tables.PairingCreationRequest = await tx.pairingCreationRequest.findMany();
    tables.User = await tx.user.findMany({ select: {
      id: true, role: true, tutorId: true, studentId: true,
      suspendedAt: true, tutorAccessRevoked: true, mergedIntoId: true,
      personId: true, historyAccessRevision: true, profileVersion: true,
      sessionVersion: true, recoveryVoidedAt: true,
    } });
    tables.Tutor = await tx.tutor.findMany({ select: {
      id: true, status: true, personId: true, historyIdentityRevision: true,
    } });
    tables.Tutee = await tx.tutee.findMany({ select: {
      id: true, status: true, personId: true, historyIdentityRevision: true,
    } });
    tables.TutorProfileOwnership = await tx.tutorProfileOwnership.findMany();
    tables.StudentProfileOwnership = await tx.studentProfileOwnership.findMany();
    // Explicit scalar/JSON selections cover the combined identity contract.
    // These are synthetic fixture records, not the operator's privacy projection.
    tables.Person = await tx.person.findMany({ select: {
      id: true, revision: true, primaryUserId: true, resolutionState: true,
      mergedIntoId: true, createdAt: true, updatedAt: true,
    } });
    tables.PersonCombineReceipt = await tx.personCombineReceipt.findMany({ select: {
      id: true, actorId: true, inputHash: true, personId: true, outcome: true,
      retiredUserIds: true, ownershipTransfers: true, createdAt: true,
    } });
    tables.PersonPartitionReceipt = await tx.personPartitionReceipt.findMany({ select: {
      id: true, actorId: true, inputHash: true, personId: true, newPersonId: true,
      sources: true, subjects: true, createdAt: true,
    } });
    tables.RetiredHistoryOwnership = await tx.retiredHistoryOwnership.findMany({ select: {
      sourceUserId: true, readerUserId: true, state: true, revision: true,
      receiptId: true, updatedAt: true,
    } });
    tables.HistoryRowOwnership = await tx.historyRowOwnership.findMany({ select: {
      entity: true, recordId: true, readerUserId: true, quarantineUserIds: true,
      sourceUserIds: true, revision: true, receiptId: true, updatedAt: true,
    } });
    tables.PersonHistoryCorrectionReceipt = await tx.personHistoryCorrectionReceipt.findMany({ select: {
      id: true, actorId: true, inputHash: true, personId: true, destinationPersonId: true,
      sourceUserIds: true, before: true, after: true, subjects: true, createdAt: true,
    } });
    tables.PersonParticipationTransferReceipt = await tx.personParticipationTransferReceipt.findMany({ select: {
      id: true, actorId: true, inputHash: true, personId: true, retainedUserId: true,
      selection: true, result: true, subjects: true, createdAt: true,
    } });
    tables.ParticipantConsolidation = await tx.participantConsolidation.findMany({ select: {
      kind: true, sourceId: true, targetId: true, active: true, revision: true,
      receiptId: true, effectiveAt: true,
    } });
    tables.PairingExecutionSuccessor = await tx.pairingExecutionSuccessor.findMany({ select: {
      sourcePairingId: true, targetPairingId: true, receiptId: true, effectiveAt: true, revision: true,
    } });
    tables.SessionPlanExecution = await tx.sessionPlanExecution.findMany({ select: {
      planId: true, tutorId: true, revision: true, receiptId: true, assignments: true,
    } });
    tables.SessionParticipantExecution = await tx.sessionParticipantExecution.findMany({ select: {
      participantId: true, sourceSurveyIds: true, tuteeId: true, revision: true, receiptId: true,
    } });
    tables.SessionResponseExecution = await tx.sessionResponseExecution.findMany({ select: {
      responseId: true, userId: true, profileKind: true, profileId: true,
      respondedByUserId: true, revision: true, receiptId: true,
    } });
    tables.TutorQualification = await tx.tutorQualification.findMany({ select: {
      tutorId: true, subjectId: true, approvedById: true, status: true, createdAt: true,
    } });
    tables.QualificationGrant = await tx.qualificationGrant.findMany({ select: {
      tutorId: true, sourceSubjectId: true, subjectId: true, grantedAt: true,
    } });
    tables.QualificationTransferGrant = await tx.qualificationTransferGrant.findMany({ select: {
      targetTutorId: true, sourceTutorId: true, sourceSubjectId: true, subjectId: true,
      approvedById: true, approvedAt: true, grantedAt: true, receiptId: true, active: true, revision: true,
    } });
    tables.StudentRequestExecutionAssignment = await tx.studentRequestExecutionAssignment.findMany({ select: {
      surveyId: true, pairingId: true, tuteeId: true, sourceTuteeId: true,
      revision: true, receiptId: true, createdAt: true, releasedAt: true,
    } });
    // Request authority and owner-review results must not be represented by an
    // edge alone. Exclude only the mailbox capability tokenHash, not lifecycle.
    tables.StudentSurvey = await tx.studentSurvey.findMany({ select: {
      id: true, email: true, intakeTermId: true, payload: true, currentPayload: true,
      currentVersion: true, policyRevision: true, policySnapshot: true, submittedAt: true,
      verificationAttempts: true, emailCodeVersion: true, expiresAt: true, confirmedAt: true,
      publicSignupEmailConfirmedAt: true, state: true, tuteeId: true, firstAssignedAt: true,
      verificationDueAt: true, editedAt: true, resolvedAt: true, lastLinkSentAt: true,
      invalidReason: true, invalidatedAt: true, invalidatedById: true,
      invalidatedByName: true, invalidityVersion: true,
    } });
    tables.SchoolDeparture = await tx.schoolDeparture.findMany();
    tables.SessionPlan = await tx.sessionPlan.findMany();
    tables.SessionPlanAssignment = await tx.sessionPlanAssignment.findMany();
    tables.SessionPlanCohort = await tx.sessionPlanCohort.findMany();
    tables.SessionPlanParticipant = await tx.sessionPlanParticipant.findMany();
    tables.SessionPlanContinuationMember = await tx.sessionPlanContinuationMember.findMany();
    tables.SessionPlanningSuggestion = await tx.sessionPlanningSuggestion.findMany();
    tables.SessionPlanningRequest = await tx.sessionPlanningRequest.findMany();
    tables.SessionPlanningOffer = await tx.sessionPlanningOffer.findMany();
    tables.SessionPlanningResponse = await tx.sessionPlanningResponse.findMany();
    tables.SessionPlanningReceipt = await tx.sessionPlanningReceipt.findMany();
    tables.SessionNotice = await tx.sessionNotice.findMany();
    tables.SessionCalendarToken = await tx.sessionCalendarToken.findMany({
      select: { id: true, userId: true, createdAt: true, revokedAt: true },
    });
    assert.equal(tables.SessionCalendarToken.length, 0,
      "The profile fixture must not create private calendar capabilities");
    tables.StudentContinuationAssignment = await tx.studentContinuationAssignment.findMany();
    tables.StudentContinuationPairing = await tx.studentContinuationPairing.findMany();
    tables.StudentContinuationReceipt = await tx.studentContinuationReceipt.findMany();
    tables.Session = await tx.session.findMany();
    tables.SessionTutee = await tx.sessionTutee.findMany();
    tables.SessionFlag = await tx.sessionFlag.findMany();
    tables.DisciplinaryCard = await tx.disciplinaryCard.findMany();
    tables.ServiceHourAdjustment = await tx.serviceHourAdjustment.findMany();
    tables.AuditLog = await tx.auditLog.findMany();
    tables.Notification = await tx.notification.findMany();
    tables.EmailDelivery = await tx.emailDelivery.findMany();
    tables.RecoveryAction = await tx.recoveryAction.findMany();
    tables.RecoveryCheckpoint = await tx.recoveryCheckpoint.findMany({ select: {
      id: true, actionId: true, schemaVersion: true, adapter: true, adapterVersion: true,
      sourceEntity: true, sourceId: true, capturedById: true, captureTransactionId: true,
      scope: true, createdAt: true,
    } });
    tables.RecoveryDeliveryEffect = await tx.recoveryDeliveryEffect.findMany({ select: {
      id: true, actionId: true, eventId: true, notificationId: true, deliveryId: true, createdAt: true,
    } });
    tables.RecoveryDeliveryCancellation = await tx.recoveryDeliveryCancellation.findMany({ select: {
      effectId: true, recoveryKey: true, disposition: true, createdAt: true,
    } });
    tables.RecoveryDeliveryCoverage = await tx.recoveryDeliveryCoverage.findMany({ select: {
      eventId: true, actionId: true, version: true, createdAt: true,
    } });
    tables.RecoveryWorkflowDraft = await tx.recoveryWorkflowDraft.findMany({ select: {
      id: true, actionId: true, sourceSurveyId: true, sourceTuteeId: true, ownerUserId: true,
      ownerBindingHash: true, answers: true, state: true, version: true,
      submittedSurveyId: true, consumedAt: true, createdAt: true,
    } });
    tables.RecoveryEvent = await tx.recoveryEvent.findMany();
    tables.RecoveryChange = await tx.recoveryChange.findMany({ orderBy: { id: "asc" } });
    tables.RecoveryTrackedEntity = await tx.recoveryTrackedEntity.findMany();
    tables.RecoveryFence = await tx.recoveryFence.findMany();
    tables.RecoveryReceipt = await tx.recoveryReceipt.findMany();
    return tables;
  }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
  // The rows retain the coherent read snapshot after commit. Pure normalization
  // is evidence processing and need not hold a database transaction open.
  return canonicalizeParity(tables, options);
}

export function compareParity(actual: ParitySnapshot, expected: ParitySnapshot): void {
  // Compare the complete graphs, but never ask AssertionError to inspect/diff
  // multi-megabyte snapshots. Its diagnostic must retain only this boolean.
  assert.ok(isDeepStrictEqual(actual, expected), "Scheduling persisted semantic state differs");
}

/** Diagnostic only: equality remains compareParity's independent responsibility.
 * Canonical JSON is traversed without serializing containers or unbounded strings.
 * Exhausted budgets are explicitly inconclusive, even for identical inputs.
 */
export function boundedParityDifference(
  actual: unknown,
  expected: unknown,
  options: Readonly<{
    maxDepth?: number;
    maxVisitedNodes?: number;
    maxPathLength?: number;
    maxPreviewLength?: number;
  }> = {},
): {
  path: string;
  kind: "type" | "scalar" | "array-length" | "missing-key" | "extra-key" | "truncated";
  actualPreview: string;
  expectedPreview: string;
  truncated: boolean;
  reason?: "depth" | "visited-nodes" | "path-length" | "non-json-value";
  visitedNodes: number;
} | null {
  const limit = (requested: number | undefined, ceiling: number, minimum = 0) =>
    requested !== undefined && Number.isSafeInteger(requested) && requested >= minimum
      ? Math.min(requested, ceiling) : ceiling;
  const maxDepth = limit(options.maxDepth, 64);
  const maxVisitedNodes = limit(options.maxVisitedNodes, 200_000, 1);
  const maxPathLength = limit(options.maxPathLength, 512);
  const maxPreviewLength = limit(options.maxPreviewLength, 160, 8);
  let visitedNodes = 0;
  type Difference = NonNullable<ReturnType<typeof boundedParityDifference>>;
  const clip = (value: string) => value.length <= maxPreviewLength
    ? value : `${value.slice(0, maxPreviewLength - 1)}…`;
  const kind = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const preview = (value: unknown): string => {
    if (typeof value === "string") {
      const prefix = value.slice(0, maxPreviewLength);
      return clip(`${JSON.stringify(prefix)}${prefix.length < value.length ? "…" : ""}`);
    }
    if (value === null) return "null";
    if (Array.isArray(value)) return clip(`[array length=${value.length}]`);
    if (typeof value === "object") return "[object]";
    if (typeof value === "number" || typeof value === "boolean") return clip(String(value));
    // Do not stringify opaque symbols/functions/bigints supplied outside JSON.
    return clip(`[${typeof value}]`);
  };
  const difference = (path: string, category: Difference["kind"], left: unknown, right: unknown): Difference => ({
    path, kind: category, actualPreview: preview(left), expectedPreview: preview(right),
    truncated: false, visitedNodes,
  });
  const truncated = (path: string, reason: NonNullable<Difference["reason"]>, left: unknown, right: unknown): Difference => ({
    ...difference(path, "truncated", left, right), truncated: true, reason,
  });
  const spend = () => {
    if (visitedNodes >= maxVisitedNodes) return false;
    visitedNodes++;
    return true;
  };
  // Escape incrementally: a single enormous key must not allocate an enormous
  // escaped path before discovering that the path budget was exceeded.
  const pointer = (parent: string, key: string): string | null => {
    let path = `${parent}/`;
    if (path.length > maxPathLength) return null;
    for (let index = 0; index < key.length; index++) {
      const character = key[index]!;
      const escaped = character === "~" ? "~0" : character === "/" ? "~1" : character;
      if (path.length + escaped.length > maxPathLength) return null;
      path += escaped;
    }
    return path;
  };
  const visit = (left: unknown, right: unknown, path: string, depth: number): Difference | null => {
    if (!spend()) return truncated(path, "visited-nodes", left, right);
    if (depth > maxDepth) return truncated(path, "depth", left, right);
    const leftKind = kind(left);
    const rightKind = kind(right);
    if (leftKind !== rightKind) return difference(path, "type", left, right);
    if (left === null || typeof left === "string" || typeof left === "boolean" || typeof left === "number")
      return Object.is(left, right) ? null : difference(path, "scalar", left, right);
    if (Array.isArray(left) && Array.isArray(right)) {
      const leftRows: readonly unknown[] = left;
      const rightRows: readonly unknown[] = right;
      if (leftRows.length !== rightRows.length) return difference(path, "array-length", leftRows.length, rightRows.length);
      for (let index = 0; index < leftRows.length; index++) {
        const next = pointer(path, String(index));
        if (next === null) return truncated(path, "path-length", left, right);
        const found = visit(leftRows[index], rightRows[index], next, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
      return truncated(path, "non-json-value", left, right);
    const leftRows = left as Readonly<Record<string, unknown>>;
    const rightRows = right as Readonly<Record<string, unknown>>;
    const keys: string[][] = [[], []];
    // Bound key enumeration too, before allocating/sorting a wide object's full
    // key set. Returning truncation preserves deterministic diagnostics safely.
    for (const [index, object] of [leftRows, rightRows].entries()) {
      for (const key in object) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
        if (!spend()) return truncated(path, "visited-nodes", left, right);
        if (key.length + path.length + 1 > maxPathLength)
          return truncated(path, "path-length", left, right);
        keys[index]!.push(key);
      }
      keys[index]!.sort();
    }
    const leftKeys = keys[0]!;
    const rightKeys = keys[1]!;
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < leftKeys.length || rightIndex < rightKeys.length) {
      const leftKey = leftKeys[leftIndex];
      const rightKey = rightKeys[rightIndex];
      const key = rightKey === undefined || (leftKey !== undefined && leftKey < rightKey) ? leftKey! : rightKey;
      const next = pointer(path, key);
      if (next === null) return truncated(path, "path-length", left, right);
      if (leftKey !== rightKey) {
        const missing = leftKey === undefined || (rightKey !== undefined && rightKey < leftKey);
        const found = difference(next, missing ? "missing-key" : "extra-key", leftRows[key], rightRows[key]);
        if (missing) found.actualPreview = "[missing]";
        else found.expectedPreview = "[missing]";
        return found;
      }
      const found = visit(leftRows[key], rightRows[key], next, depth + 1);
      if (found) return found;
      leftIndex++;
      rightIndex++;
    }
    return null;
  };
  return visit(actual, expected, "", 0);
}
