import { expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { expireStudentRequests } from "~/server/student-request-state";
import { auditActorScope } from "~/server/db-scope";

function expiredFixture(failAudit = false) {
  type State = { state: string; status: string; linked: boolean; audits: unknown[] };
  const state: State = { state: "OPEN", status: "ACTIVE", linked: true, audits: [] };
  const dueAt = new Date("2026-10-08T00:00:00Z");
  const client = (current: State) => ({
    $executeRaw: async () => 1,
    studentSurvey: {
      findMany: async () => current.state === "OPEN" ? [{ id: "survey", email: "PRIVATE_EMAIL" }] : [],
      findUniqueOrThrow: async () => ({ id: "survey", email: "PRIVATE_EMAIL", state: current.state,
        tuteeId: "student", verificationDueAt: dueAt, confirmedAt: null, passwordHash: "PRIVATE_HASH" }),
      update: async ({ data }: { data: { state: string } }) => { current.state = data.state; return {}; },
    },
    pairingTutee: { findMany: async () => current.linked ? [{ pairingId: "pairing", pairing: { tutorId: "tutor" } }] : [],
      deleteMany: async () => { current.linked = false; return { count: 1 }; } },
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
  expect(JSON.stringify(f.state.audits)).not.toMatch(/PRIVATE_EMAIL|PRIVATE_HASH/);
});

it("rolls back deadline expiry and roster effects if the system audit cannot commit", async () => {
  const f = expiredFixture(true);
  await expect(expireStudentRequests(f.db, f.now)).rejects.toThrow("Audit unavailable");
  expect(f.state).toEqual({ state: "OPEN", status: "ACTIVE", linked: true, audits: [] });
});
