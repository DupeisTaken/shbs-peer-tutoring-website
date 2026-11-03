import { expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { expireStudentRequests } from "~/server/student-request-state";
import { auditActorScope } from "~/server/db-scope";

function expiredFixture(failAudit = false) {
  type Mapping = { surveyId: string; pairingId: string; tuteeId: string; sourceTuteeId: string; releasedAt: Date | null; revision: number };
  type Action = { id: string; kind: string; before: unknown; after?: unknown };
  type Checkpoint = { id: string; actionId: string; schemaVersion: number; adapter: string; sourceId: string; capturedById: string };
  type Tracked = { actionId: string; entity: string; recordId: string };
  type State = { state: string; status: string; linked: boolean; mappings: Mapping[]; audits: unknown[];
    actions: Action[]; checkpoints: Checkpoint[]; tracked: Tracked[]; events: unknown[];
    settings: { action: string | null; kind: string | null; compensating: null; delivery: string | null } };
  const state: State = { state: "OPEN", status: "ACTIVE", linked: true, mappings: [], audits: [],
    actions: [], checkpoints: [], tracked: [], events: [], settings: { action: null, kind: null, compensating: null, delivery: null } };
  const initialState = structuredClone(state);
  const order: string[] = [];
  const textValue = (value: unknown) => {
    if (typeof value !== "string") throw new Error("Expected a fixture SQL text parameter");
    return value;
  };
  const dueAt = new Date("2026-10-08T00:00:00Z");
  const source = (current: State) => ({ id: "survey", email: "PRIVATE_EMAIL", state: current.state,
    payload: { englishName: "Synthetic Student" }, currentPayload: null,
    tuteeId: "student", intakeTermId: "term", submittedAt: new Date("2026-10-01T00:00:00Z"),
    verificationDueAt: dueAt, confirmedAt: null, passwordHash: "PRIVATE_HASH" });
  const client = (current: State) => ({
    $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      if (sql.includes("pg_advisory_xact_lock")) order.push(`lock:${textValue(values[0])}`);
      else if (sql.includes('INSERT INTO "UsernameNamespaceGuard"')) order.push("namespace-write");
      else throw new Error(`Unexpected fixture command: ${sql}`);
      return 1;
    },
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      if (sql.includes("AS action,current_setting")) return [{ ...current.settings }];
      if (sql.includes("txid_current()")) return [{ transactionId: "fixture-transaction" }];
      if (sql.includes("set_config('shbs.recovery_action'")) {
        current.settings.action = textValue(values[0]) || null;
        current.settings.kind = textValue(values[1]) || null;
        order.push(current.settings.action ? "bind-checkpoint" : "restore-checkpoint");
        return [];
      }
      if (sql.includes("AS value")) return [{ value: current.settings.delivery }];
      if (sql.includes('FROM "RecoveryTrackedEntity"')) {
        const active = current.actions.find((action) => action.id === current.settings.action && ["INITIAL_ADMISSION", "DOMAIN_CHECKPOINT"].includes(action.kind));
        const tracked = active && current.tracked.find((row) => row.actionId === active.id && row.entity === values[0] && row.recordId === values[1]);
        return tracked ? [{ actionId: tracked.actionId }] : [];
      }
      if (sql.includes("set_config('shbs.recovery_delivery_source'")) {
        current.settings.delivery = textValue(values[0]) || null;
        order.push(current.settings.delivery ? "bind-delivery-source" : "restore-delivery-source");
        return [];
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
    recoveryAction: {
      create: async ({ data }: { data: Omit<Action, "id"> }) => {
        const action = { id: "checkpoint-action", ...data }; current.actions.push(action); order.push("capture-action"); return action;
      },
      update: async ({ data }: { data: { after: unknown } }) => { Object.assign(current.actions[0]!, data); return current.actions[0]; },
    },
    recoveryCheckpoint: { create: async ({ data }: { data: Omit<Checkpoint, "id"> }) => {
      const checkpoint = { id: "checkpoint", ...data }; current.checkpoints.push(checkpoint); order.push("capture-checkpoint"); return checkpoint;
    } },
    recoveryTrackedEntity: { createMany: async ({ data }: { data: Tracked[] }) => { current.tracked.push(...data); return { count: data.length }; } },
    recoveryEvent: { create: async ({ data }: { data: unknown }) => { current.events.push(data); return {}; } },
    studentSurvey: {
      findMany: async () => current.state === "OPEN" ? [source(current)] : [],
      findUniqueOrThrow: async () => source(current),
      findUnique: async () => source(current),
      count: async () => 0, // No other independent request owns this legacy member.
      updateMany: async ({ data }: { data: { state: string } }) => { order.push("close-request"); current.state = data.state; return { count: 1 }; },
    },
    // Start with genuine legacy ownership, then persist the exact release tombstone.
    studentRequestExecutionAssignment: {
      findMany: async ({ where }: { where: { surveyId: string | { not: string }; releasedAt?: null } }) =>
        current.mappings.filter((row) => typeof where.surveyId === "string"
          ? row.surveyId === where.surveyId && (where.releasedAt === undefined || row.releasedAt === null)
          : row.surveyId !== where.surveyId.not && row.releasedAt === null),
      count: async () => current.mappings.length,
      createMany: async ({ data }: { data: Omit<Mapping, "releasedAt" | "revision">[] }) => {
        current.mappings.push(...data.map((row) => ({ ...row, releasedAt: null, revision: 1 })));
        return { count: data.length };
      },
      updateMany: async ({ data }: { data: { releasedAt: Date } }) => {
        for (const row of current.mappings) { row.releasedAt = data.releasedAt; row.revision += 1; }
        return { count: current.mappings.length };
      },
    },
    participantConsolidation: { findUnique: async () => null, findMany: async () => [] },
    pairingExecutionSuccessor: { findMany: async () => [], count: async () => 0 },
    pairingTutee: { findMany: async () => current.linked ? [{ pairingId: "pairing", tuteeId: "student", pairing: { tutorId: "tutor" } }] : [],
      count: async () => Number(current.linked),
      deleteMany: async () => { order.push("release-roster"); current.linked = false; return { count: 1 }; } },
    sessionPlan: { findMany: async () => [] },
    term: { findMany: async () => [{ id: "term" }], findUniqueOrThrow: async () => ({ id: "term", active: true }) },
    studentProfileOwnership: { findUnique: async () => null },
    historyRowOwnership: { findUnique: async () => null }, personCombineReceipt: { findMany: async () => [] },
    user: { findMany: async () => [], findUnique: async () => null }, notification: { createMany: async () => { order.push("notice-before-detach"); return { count: 0 }; } },
    tutee: { findUnique: async () => ({ status: current.status }), findUniqueOrThrow: async () => ({ id: "student", personId: null, historyIdentityRevision: 0, status: current.status }),
      updateMany: async () => { current.status = "INACTIVE"; return { count: 1 }; } },
    studentRequestReview: { updateMany: async () => ({ count: 1 }) },
    auditLog: { create: async ({ data }: { data: unknown }) => {
      order.push("system-audit"); if (failAudit) throw new Error("Audit unavailable"); current.audits.push(data); return {};
    } },
  });
  const db = { ...client(state), $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const draft = structuredClone(state); const result = await work(client(draft));
    Object.assign(state, draft); return result;
  } } as unknown as PrismaClient;
  return { db, state, initialState, order, now: new Date("2026-10-09T00:00:00Z") };
}

it("attributes deadline expiry to the system, links dependent removal, and stays idempotent", async () => {
  const f = expiredFixture();
  expect(await auditActorScope.run({ id: "head", name: "Head", role: "HEAD" }, () => expireStudentRequests(f.db, f.now))).toBe(1);
  expect(f.state).toMatchObject({ state: "DISQUALIFIED", status: "INACTIVE", linked: false, audits: [{
    userId: null, userName: "System", operation: "system.expireStudentRequest",
    details: { actorRole: "SYSTEM", initiatingActorId: "head", initiatingActorRole: "HEAD", outcome: "APPLIED",
      before: { state: "OPEN" }, after: { state: "DISQUALIFIED" }, effects: { removedPairingIds: ["pairing"] } },
  }] });
  expect(await expireStudentRequests(f.db, f.now)).toBe(0);
  expect(f.state.audits).toHaveLength(1);
  expect(f.state.mappings).toEqual([{ surveyId: "survey", pairingId: "pairing", tuteeId: "student",
    sourceTuteeId: "student", releasedAt: f.now, revision: 2 }]);
  // The real checkpoint helper records unsupported legacy answer evidence rather
  // than blocking ordinary expiry or inventing a restorable source snapshot.
  expect(f.state.checkpoints).toEqual([expect.objectContaining({ actionId: "checkpoint-action", schemaVersion: 0, adapter: "STUDENT_WORKFLOW", sourceId: "survey", capturedById: "SYSTEM" })]);
  expect(f.state.actions).toMatchObject([{ kind: "DOMAIN_CHECKPOINT", before: { unsupportedSnapshot: true, adapter: "STUDENT_WORKFLOW" } }]);
  expect(f.state.tracked).toEqual([{ actionId: "checkpoint-action", entity: "StudentSurvey", recordId: "survey" }]);
  expect(f.state.events).toMatchObject([{ actionId: "checkpoint-action", kind: "CHECKPOINT_CAPTURE", transactionId: "fixture-transaction" }]);
  expect(JSON.stringify([f.state.actions, f.state.checkpoints, f.state.events])).not.toMatch(/PRIVATE_EMAIL|PRIVATE_HASH/);
  expect(f.state.settings).toEqual(f.initialState.settings);
  const before = (first: string, second: string) => {
    expect(f.order.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(f.order.indexOf(second)).toBeGreaterThan(f.order.indexOf(first));
  };
  before("lock:program:period", "lock:identity:username-namespace");
  before("namespace-write", "lock:course-catalogue");
  before("capture-checkpoint", "bind-checkpoint");
  before("bind-checkpoint", "close-request");
  before("notice-before-detach", "release-roster");
  before("release-roster", "system-audit");
  before("system-audit", "restore-checkpoint");
  expect(JSON.stringify(f.state.audits)).not.toMatch(/PRIVATE_EMAIL|PRIVATE_HASH/);
});

it("rolls back deadline expiry and roster effects if the system audit cannot commit", async () => {
  const f = expiredFixture(true);
  await expect(expireStudentRequests(f.db, f.now)).rejects.toThrow("Audit unavailable");
  expect(f.order).toContain("capture-checkpoint");
  expect(f.order.indexOf("system-audit")).toBeGreaterThan(f.order.indexOf("release-roster"));
  expect(f.state).toEqual(f.initialState);
});
