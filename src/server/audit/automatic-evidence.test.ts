import { expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { expireStudentRequests } from "~/server/student-request-state";
import { auditActorScope } from "~/server/db-scope";

function expiredFixture(failAudit = false) {
  type Mapping = { surveyId: string; pairingId: string; tuteeId: string; sourceTuteeId: string; releasedAt: Date | null; revision: number };
  type State = { state: string; status: string; linked: boolean; mappings: Mapping[]; audits: unknown[] };
  const state: State = { state: "OPEN", status: "ACTIVE", linked: true, mappings: [], audits: [] };
  const dueAt = new Date("2026-10-08T00:00:00Z");
  const source = (current: State) => ({ id: "survey", email: "PRIVATE_EMAIL", state: current.state,
    payload: { englishName: "Synthetic Student" }, currentPayload: null,
    tuteeId: "student", intakeTermId: "term", submittedAt: new Date("2026-10-01T00:00:00Z"),
    verificationDueAt: dueAt, confirmedAt: null, passwordHash: "PRIVATE_HASH" });
  const client = (current: State) => ({
    $executeRaw: async () => 1,
    studentSurvey: {
      findMany: async () => current.state === "OPEN" ? [source(current)] : [],
      findUniqueOrThrow: async () => source(current),
      findUnique: async () => source(current),
      count: async () => 0, // No other independent request owns this legacy member.
      updateMany: async ({ data }: { data: { state: string } }) => { current.state = data.state; return { count: 1 }; },
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
      deleteMany: async () => { current.linked = false; return { count: 1 }; } },
    sessionPlan: { findMany: async () => [] },
    term: { findMany: async () => [{ id: "term" }] },
    studentProfileOwnership: { findUnique: async () => null },
    user: { findMany: async () => [] }, notification: { createMany: async () => ({ count: 0 }) },
    tutee: { findUnique: async () => ({ status: current.status }),
      updateMany: async () => { current.status = "INACTIVE"; return { count: 1 }; } },
    studentRequestReview: { updateMany: async () => ({ count: 1 }) },
    auditLog: { create: async ({ data }: { data: unknown }) => {
      if (failAudit) throw new Error("Audit unavailable"); current.audits.push(data); return {};
    } },
  });
  const db = { ...client(state), $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    const draft = structuredClone(state); const result = await work(client(draft));
    Object.assign(state, draft); return result;
  } } as unknown as PrismaClient;
  return { db, state, now: new Date("2026-10-09T00:00:00Z") };
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
  expect(JSON.stringify(f.state.audits)).not.toMatch(/PRIVATE_EMAIL|PRIVATE_HASH/);
});

it("rolls back deadline expiry and roster effects if the system audit cannot commit", async () => {
  const f = expiredFixture(true);
  await expect(expireStudentRequests(f.db, f.now)).rejects.toThrow("Audit unavailable");
  expect(f.state).toEqual({ state: "OPEN", status: "ACTIVE", linked: true, mappings: [], audits: [] });
});
