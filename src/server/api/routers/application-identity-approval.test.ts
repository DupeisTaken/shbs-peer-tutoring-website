import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import superjson from "superjson";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import { ApprovalQueued, fingerprint, proposalTargets } from "~/server/approvals";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// Stale Head claims deliberately exercise current database authority before interception.
const caller = (id: string) => createCaller({
  db, headers: new Headers(), session: {
    user: { id, name: "Old cookie name", email: `${id}@example.test` },
    role: "HEAD", tutorId: null, expires: "2099-01-01",
  } satisfies Session,
});

async function queued(work: () => Promise<unknown>) {
  try { await work(); }
  catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause, String(error)).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw new Error("Expected an immutable proposal, not a live application change");
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the serial shbs_shipping_test database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables
    .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: ([
    ["head", "HEAD"], ["admin", "ADMIN"], ["other-admin", "ADMIN"],
    ["coordinator", "COORDINATOR"], ["other-coordinator", "COORDINATOR"], ["viewer", "VIEWER"], ["tutor", "TUTOR"],
  ] as const).map(([id, role]) => ({ id, role, username: id,
    name: `Current ${id}`, email: `${id}@example.test` })) });
  await db.term.create({ data: {
    name: "Identity review", schoolYear: "26-27", quarter: "Q1", active: true,
  } });
});
afterAll(() => db.$disconnect());

async function fixture() {
  const app = await db.tutorApplication.create({ data: {
    name: "李明", email: "candidate@example.test", preferredContact: "Original contact",
    policyRevision: "original-policy", policySnapshot: { text: "Original consent" },
    policyAcceptedAt: new Date("2026-09-01T00:00:00Z"),
  } });
  return { app, input: {
    id: app.id, expectedUpdatedAt: app.updatedAt, clientKey: randomUUID(),
    firstName: "Ming", lastName: "Li", preferredName: null, alternativeNames: "李明",
    reason: "Applicant confirmed the structured spelling",
  } };
}

it.each(["admin", "head"])("lets %s correct names directly without changing consent or account identity", async (id) => {
  const { app, input } = await fixture();
  await caller(id).admin.correctApplicationIdentity(input);
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({
    name: "Ming Li", identityRevision: 1, email: app.email, policySnapshot: app.policySnapshot,
    policyRevision: app.policyRevision, policyAcceptedAt: app.policyAcceptedAt,
  });
  expect(await db.applicationIdentityCorrection.findFirstOrThrow()).toMatchObject({ actorId: id, approvalId: null });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.tutor.count()).toBe(0);
});

it("denies Viewer and participant before creating any correction proposal", async () => {
  const { input } = await fixture();
  for (const id of ["viewer", "tutor"])
    await expect(caller(id).admin.correctApplicationIdentity(input))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("validates the names-only payload and eligibility before queue interception", async () => {
  const { app, input } = await fixture();
  await expect(caller("coordinator").admin.correctApplicationIdentity({ ...input, firstName: "明" }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  const forged = { ...input, email: "replacement@example.test" };
  await expect(caller("admin").admin.correctApplicationIdentity(forged))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.tutorApplication.update({ where: { id: app.id }, data: { status: "REJECTED" } });
  await expect(caller("admin").admin.correctApplicationIdentity(input))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.approvalRequest.count()).toBe(0);
});

it("queues one exact Coordinator intent, rejects a changed retry and applies through Admin", async () => {
  const { app, input } = await fixture();
  const first = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  const second = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  expect(second.id).toBe(first.id);
  await expect(caller("coordinator").admin.correctApplicationIdentity({ ...input, firstName: "Mingjie" }))
    .rejects.toMatchObject({ code: "CONFLICT", message: "APPLICATION_IDENTITY_RETRY_CHANGED" });
  await expect(caller("coordinator").admin.correctApplicationIdentity({ ...input, reason: "A different justification" }))
    .rejects.toMatchObject({ code: "CONFLICT", message: "APPLICATION_IDENTITY_RETRY_CHANGED" });
  expect(await db.approvalRequest.count()).toBe(1);
  expect(await db.notification.count({ where: { link: `/admin/approvals?request=${first.id}` } })).toBe(2);
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } })).toEqual(app);
  expect(first.targets).toMatchObject({ applicationIdentity: {
    original: { name: "李明", firstName: null }, current: { name: "李明" },
    next: { name: "Ming Li", firstName: "Ming", lastName: "Li" }, revision: 0,
  } });
  await caller("other-admin").approval.decide({ id: first.id, approve: true, note: "Applicant evidence checked" });
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({
    name: "Ming Li", identityRevision: 1, status: "PENDING", email: app.email,
    preferredContact: app.preferredContact, policyRevision: app.policyRevision,
    policySnapshot: app.policySnapshot, policyAcceptedAt: app.policyAcceptedAt,
  });
  expect(await db.applicationIdentityCorrection.findFirstOrThrow()).toMatchObject({
    actorId: "other-admin", actorName: "Current other-admin", approvalId: first.id, revision: 1,
  });
  expect(await db.auditLog.findFirstOrThrow({ where: {
    operation: "admin.correctApplicationIdentity", entity: "TutorApplication", entityId: app.id,
  } })).toMatchObject({ userId: "other-admin", approvalId: first.id });
  expect(await db.tutor.count()).toBe(0);
  expect(await db.registrationCode.count()).toBe(0);
  await expect(caller("coordinator").admin.correctApplicationIdentity(input))
    .rejects.toMatchObject({ code: "CONFLICT", message: "APPLICATION_IDENTITY_PROPOSAL_DECIDED" });
  expect(await db.approvalRequest.count()).toBe(1);
  expect(await db.applicationIdentityCorrection.count()).toBe(1);
});

it("keeps distinct Coordinator receipt namespaces when Head reviews the same client key", async () => {
  const first = await fixture();
  const second = await fixture();
  const otherInput = { ...second.input, clientKey: first.input.clientKey, firstName: "Lin" };
  const firstRequest = await queued(() => caller("coordinator").admin.correctApplicationIdentity(first.input));
  const secondRequest = await queued(() => caller("other-coordinator").admin.correctApplicationIdentity(otherInput));
  await caller("head").approval.decide({ id: firstRequest.id, approve: true, note: "First record checked" });
  await caller("head").approval.decide({ id: secondRequest.id, approve: true, note: "Second record checked" });
  expect(await db.applicationIdentityCorrection.count()).toBe(2);
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: second.app.id } }))
    .toMatchObject({ firstName: "Lin", identityRevision: 1 });
});

it("recovers an unchanged pending submission after target drift without replacing its evidence", async () => {
  const { app, input } = await fixture();
  const request = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  await db.tutorApplication.update({ where: { id: app.id }, data: {
    interviewAt: new Date("2026-10-24T00:00:00Z"), updatedAt: new Date(app.updatedAt.getTime() + 1000),
  } });
  const retry = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  expect(retry).toEqual(request);
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Old review" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("refuses replay after requester loses Coordinator authority", async () => {
  const { input } = await fixture();
  const request = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  await db.user.update({ where: { id: "coordinator" }, data: { role: "VIEWER" } });
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Role changed" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  await expect(caller("coordinator").admin.correctApplicationIdentity(input))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
    .toMatchObject({ state: "PENDING" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("stales a queued correction when current name policy changes", async () => {
  const { input } = await fixture();
  const request = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  await db.programSettings.create({ data: { id: "program", nameFieldsVersion: 1 } });
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Policy changed" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("stales captured account identity even when the application itself did not change", async () => {
  const { app, input } = await fixture();
  const account = await db.user.create({ data: { username: "candidate", email: app.email,
    emailVerifiedAt: new Date(), firstName: "Verified", lastName: "Identity" } });
  const request = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  await db.user.update({ where: { id: account.id }, data: {
    firstName: "Changed", profileVersion: { increment: 1 },
  } });
  expect((await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } })).updatedAt)
    .toEqual(app.updatedAt);
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Account changed" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("stales captured panel votes without mutating or discarding those votes", async () => {
  const { app, input } = await fixture();
  const tutor = await db.tutor.create({ data: { englishName: "Panel member" } });
  await db.interviewAssignment.create({ data: { applicationId: app.id, tutorId: tutor.id, isHead: true } });
  const vote = { applicationId: app.id, tutorId: tutor.id };
  await db.interviewVote.create({ data: { ...vote, accept: true } });
  const request = await queued(() => caller("coordinator").admin.correctApplicationIdentity(input));
  await db.interviewVote.update({ where: { applicationId_tutorId: vote }, data: { comment: "Later evidence" } });
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Vote changed" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.interviewVote.findUniqueOrThrow({ where: { applicationId_tutorId: vote } }))
    .toMatchObject({ accept: true, comment: "Later evidence" });
  expect(await db.applicationIdentityCorrection.count()).toBe(0);
});

it("preserves untouched decision fingerprints but stales a queued decision after a correction", async () => {
  const { app, input } = await fixture();
  const decision = { id: app.id, status: "REJECTED" as const, expectedUpdatedAt: app.updatedAt };
  const before = await proposalTargets(db, "admin.setApplicationStatus", superjson.serialize(decision));
  expect(JSON.stringify(before)).not.toContain("identityRevision");
  const request = await queued(() => caller("coordinator").admin.setApplicationStatus(decision));
  await caller("head").admin.correctApplicationIdentity(input);
  const after = await proposalTargets(db, "admin.setApplicationStatus", superjson.serialize(decision));
  expect(JSON.stringify(after)).toContain('"identityRevision":1');
  expect(fingerprint(after)).not.toBe(fingerprint(before));
  await expect(caller("head").approval.decide({ id: request.id, approve: true, note: "Recheck corrected identity" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } }))
    .toMatchObject({ status: "PENDING", identityRevision: 1 });
});

it("keeps flagged application restrictions while exposing accurate readiness in detail and lists", async () => {
  const { app, input } = await fixture();
  const flagged = await db.tutorApplication.update({ where: { id: app.id }, data: {
    invalidReason: "Duplicate review still unresolved", invalidatedAt: new Date(), invalidityVersion: 1,
  } });
  expect((await caller("head").admin.tutorApplications()).find((row) => row.id === app.id))
    .toMatchObject({ identityNeedsReview: true });
  await caller("head").admin.correctApplicationIdentity({ ...input, expectedUpdatedAt: flagged.updatedAt });
  const current = await db.tutorApplication.findUniqueOrThrow({ where: { id: app.id } });
  expect(current).toMatchObject({ invalidityVersion: 1, invalidatedAt: flagged.invalidatedAt,
    invalidReason: flagged.invalidReason, status: "PENDING" });
  expect(await caller("coordinator").admin.applicationIdentity({ applicationId: app.id }))
    .toMatchObject({ revision: 1, original: { name: "李明" }, current: { name: "Ming Li" },
      readiness: { ready: true, source: "APPLICATION" } });
  expect((await caller("head").admin.tutorApplications()).find((row) => row.id === app.id))
    .toMatchObject({ identityNeedsReview: false });
  await expect(caller("head").admin.setApplicationStatus({
    id: app.id, status: "ACCEPTED", expectedUpdatedAt: current.updatedAt,
  })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
