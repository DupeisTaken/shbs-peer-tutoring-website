import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { Prisma } from "../../../generated/prisma";
import superjson from "superjson";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { fingerprint, queueProposal } from "~/server/approvals";
import { hashPassword } from "~/server/auth/password";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { requestMembership } from "~/server/membership";

const head = "c000000000000000000000491";
const admin = "c000000000000000000000492";
const coordinator = "c000000000000000000000493";
const requester = "c000000000000000000000494";
const password = "Synthetic-review-cutover-492!";
const session = (id: string, role: Session["role"]): Session => ({
  user: { id, name: role, email: `${id}@example.test` }, role,
  tutorId: null, expires: "2099-01-01",
});
const caller = (id = head, role: Session["role"] = "HEAD") =>
  createCaller({ db, headers: new Headers(), session: session(id, role) });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Review reconciliation owns only serial shbs_shipping_test fixtures");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: ([
    [head, "HEAD"], [admin, "STUDENT"], [coordinator, "COORDINATOR"], [requester, "ADMIN"],
  ] as const).map(([id, role]) => ({ id, role, email: `${id}@example.test`,
    name: role, passwordHash: hashPassword(password) })) });
  await db.term.create({ data: { id: "notification-cutover-term", schoolYear: "26-27",
    quarter: "Q1", name: "Notification cutover", active: true } });
});
afterAll(() => db.$disconnect());

/** Preserve a real pre-cutover authority snapshot and its Head-only notice. */
async function legacyPending() {
  const request = await queueProposal(session(requester, "ADMIN"),
    "program.setTimeZone", { timeZone: "UTC", expectedTimeZone: "Asia/Shanghai" });
  const targets = request.targets as Record<string, Prisma.InputJsonValue>;
  delete targets.reviewPolicyVersion;
  targets.reviewAuthority = { category: "ACCOUNT_ACCESS", directRoles: ["HEAD"],
    requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  // This fixture reconstructs the historical delivery before exercising repair.
  await db.notification.updateMany({ where: { link: `/admin/approvals?request=${request.id}` },
    data: { title: "Management change awaiting Head approval", event: "management_head_review_pending" } });
  return db.approvalRequest.update({ where: { id: request.id },
    data: { targets, fingerprint: fingerprint(targets) } });
}
const requestNotices = (id: string) => db.notification.findMany({
  where: { link: `/admin/approvals?request=${id}` }, orderBy: { userId: "asc" },
});

/** Historical domain queues had only queue-wide Head notices. The source rows
 * and those old deliveries must survive the explicit reconciliation unchanged. */
async function pendingDomainQueues() {
  await db.user.update({ where: { id: requester }, data: { role: "STUDENT" } });
  const tutor = await db.tutor.create({ data: { englishName: "Pending Tutor", status: "ACTIVE" } });
  const owner = await db.user.create({ data: { email: "domain-owner@example.test", role: "TUTOR",
    name: "Domain Owner", tutorId: tutor.id, crewStatus: "ACTIVE" } });
  const tutorRequest = await db.tutorStatusRequest.create({ data: { tutorId: tutor.id,
    kind: "OPT_OUT", reason: "Original tutor request evidence", eligibleAt: new Date("2099-01-01") } });
  const crewRequest = await db.crewStatusRequest.create({ data: { userId: owner.id,
    kind: "OPT_OUT", reason: "Original crew request evidence", eligibleAt: new Date("2099-01-01") } });
  const application = await db.crewApplication.create({ data: { name: "Public Crew Applicant",
    email: "domain-applicant@example.test", message: "Original application evidence" } });
  await db.notification.createMany({ data: [
    { userId: head, title: "Original Head tutor queue notice", event: "tutor_optout_requested", link: "/admin/tutor-requests" },
    { userId: head, title: "Original Head crew queue notice", event: "crew_optout_requested", link: "/admin/crew" },
    { userId: head, title: "Original Head application queue notice", event: "crew_application_pending", link: "/admin/crew" },
  ] });
  const originalNotices = await db.notification.findMany({ orderBy: { id: "asc" } });
  const links = [
    `/admin/tutor-requests#request-${tutorRequest.id}`,
    `/admin/crew#request-${crewRequest.id}`,
    `/admin/crew#application-${application.id}`,
  ];
  return { tutor, owner, tutorRequest, crewRequest, application, originalNotices, links };
}
const sourceNotices = (links: string[]) => db.notification.findMany({
  where: { link: { in: links } }, orderBy: [{ userId: "asc" }, { link: "asc" }],
});
async function expectDomainEvidencePreserved(source: Awaited<ReturnType<typeof pendingDomainQueues>>) {
  expect(await db.tutorStatusRequest.findUniqueOrThrow({ where: { id: source.tutorRequest.id } })).toEqual(source.tutorRequest);
  expect(await db.crewStatusRequest.findUniqueOrThrow({ where: { id: source.crewRequest.id } })).toEqual(source.crewRequest);
  expect(await db.crewApplication.findUniqueOrThrow({ where: { id: source.application.id } })).toEqual(source.application);
  for (const notice of source.originalNotices)
    expect(await db.notification.findUniqueOrThrow({ where: { id: notice.id } })).toEqual(notice);
}

it("appends three source-specific domain notices concurrently without rewriting legacy queue notices or source evidence", async () => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  const repairs = await Promise.all([
    caller(admin, "ADMIN").notification.reconcileManagementReviews(),
    caller().notification.reconcileManagementReviews(),
  ]);
  expect(repairs.every((repair) => repair.pending === 3)).toBe(true);
  expect(repairs.reduce((sum, repair) => sum + repair.created, 0)).toBe(3);
  const notices = await sourceNotices(source.links);
  expect(notices).toHaveLength(3);
  expect(notices.every((notice) => notice.userId === admin)).toBe(true);
  expect(notices.map((notice) => notice.event).sort()).toEqual([
    "crew_application_pending", "crew_optout_requested", "tutor_optout_requested",
  ]);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 3, created: 0 });
  expect(await sourceNotices(source.links)).toEqual(notices);
  await expectDomainEvidencePreserved(source);
});

it("a new Admin promotion finds all three existing domain queues without changing their original evidence", async () => {
  const source = await pendingDomainQueues();
  await caller().admin.setUserRole({ userId: admin, role: "ADMIN", confirmPassword: password });
  const notices = await sourceNotices(source.links);
  expect(notices).toHaveLength(3);
  expect(notices.every((notice) => notice.userId === admin)).toBe(true);
  expect(await caller(admin, "ADMIN").notification.reconcileManagementReviews()).toMatchObject({ pending: 3, created: 0 });
  await expectDomainEvidencePreserved(source);
});

it("uses Head fallback for each domain source while retaining the old queue-wide notice and deduplicating retries", async () => {
  const source = await pendingDomainQueues();
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 3, created: 3 });
  const notices = await sourceNotices(source.links);
  expect(notices).toHaveLength(3);
  expect(notices.every((notice) => notice.userId === head)).toBe(true);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 3, created: 0 });
  expect(await sourceNotices(source.links)).toEqual(notices);
  await expectDomainEvidencePreserved(source);
});

it("includes only pending sources and leaves approved, denied, recalled and decided application evidence unchanged", async () => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  for (const state of ["APPROVED", "DENIED", "RECALLED"] as const) {
    await db.tutorStatusRequest.create({ data: { tutorId: source.tutor.id, kind: "OPT_OUT", state,
      reason: `Retained ${state} tutor evidence`, resolvedAt: new Date("2026-01-01") } });
    await db.crewStatusRequest.create({ data: { userId: source.owner.id, kind: "OPT_OUT", state,
      reason: `Retained ${state} crew evidence`, decidedAt: new Date("2026-01-01") } });
  }
  for (const status of ["ACCEPTED", "REJECTED"] as const)
    await db.crewApplication.create({ data: { name: "Decided Applicant", email: `${status}@example.test`,
      status, decisionComment: "Original decision", decidedAt: new Date("2026-01-01") } });
  const original = { tutor: await db.tutorStatusRequest.findMany({ orderBy: { id: "asc" } }),
    crew: await db.crewStatusRequest.findMany({ orderBy: { id: "asc" } }),
    application: await db.crewApplication.findMany({ orderBy: { id: "asc" } }) };
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 3, created: 3 });
  const notices = await sourceNotices(source.links);
  expect(notices).toHaveLength(3);
  expect(await db.notification.count()).toBe(6);
  expect(await db.tutorStatusRequest.findMany({ orderBy: { id: "asc" } })).toEqual(original.tutor);
  expect(await db.crewStatusRequest.findMany({ orderBy: { id: "asc" } })).toEqual(original.crew);
  expect(await db.crewApplication.findMany({ orderBy: { id: "asc" } })).toEqual(original.application);
  await expectDomainEvidencePreserved(source);
});

it.each([
  ["suspended", 1], ["retired", 1], ["revoked-tutor", 2],
  ["archived-tutor", 2], ["unlinked-tutor", 2], ["inactive-crew", 2],
] as const)("does not append actionable domain notices for %s membership", async (restriction, expectedCreated) => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  if (restriction === "archived-tutor")
    await db.tutor.update({ where: { id: source.tutor.id }, data: { status: "ARCHIVED" } });
  else await db.user.update({ where: { id: source.owner.id }, data:
    restriction === "suspended" ? { suspendedAt: new Date() }
      : restriction === "retired" ? { mergedIntoId: head }
        : restriction === "revoked-tutor" ? { tutorAccessRevoked: true }
          : restriction === "unlinked-tutor" ? { tutorId: null }
            : { crewStatus: "INACTIVE" },
  });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: expectedCreated });
  const notices = await sourceNotices(source.links);
  expect(notices).toHaveLength(expectedCreated);
  expect(notices.every((notice) => notice.userId === admin)).toBe(true);
  expect(notices.some((notice) => notice.link === source.links[2])).toBe(true);
  if (["suspended", "retired", "revoked-tutor", "archived-tutor", "unlinked-tutor"].includes(restriction))
    expect(notices.some((notice) => notice.link === source.links[0])).toBe(false);
  if (["suspended", "retired", "inactive-crew"].includes(restriction))
    expect(notices.some((notice) => notice.link === source.links[1])).toBe(false);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  await expectDomainEvidencePreserved(source);
});

it("routes reentry only for currently opted-out membership while preserving each original request", async () => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  const tutorRequest = await db.tutorStatusRequest.update({ where: { id: source.tutorRequest.id },
    data: { kind: "REENTRY", eligibleAt: null } });
  const crewRequest = await db.crewStatusRequest.update({ where: { id: source.crewRequest.id },
    data: { kind: "REENTRY", eligibleAt: null } });
  // Current ACTIVE membership makes these historical reentry intents stale.
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 1 });
  expect((await sourceNotices(source.links)).map((notice) => notice.event)).toEqual(["crew_application_pending"]);
  await db.tutor.update({ where: { id: source.tutor.id }, data: { status: "OPTED_OUT" } });
  await db.user.update({ where: { id: source.owner.id }, data: { crewStatus: "OPTED_OUT" } });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 2 });
  expect((await sourceNotices(source.links)).map((notice) => notice.event).sort()).toEqual([
    "crew_application_pending", "crew_reentry_requested", "tutor_reentry_requested",
  ]);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  await expectDomainEvidencePreserved({ ...source, tutorRequest, crewRequest });
});

it("recognizes canonical notices from actual new membership submissions without appending repair duplicates", async () => {
  await db.user.update({ where: { id: requester }, data: { role: "STUDENT" } });
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  const tutor = await db.tutor.create({ data: { englishName: "New Request Tutor", status: "ACTIVE" } });
  const owner = await db.user.create({ data: { email: "new-request-owner@example.test", role: "TUTOR",
    tutorId: tutor.id, crewStatus: "ACTIVE" } });
  const tutorRequest = await requestMembership(db, { kind: "tutor", id: tutor.id }, "OPT_OUT", "New tutor request");
  const crewRequest = await requestMembership(db, { kind: "crew", id: owner.id }, "OPT_OUT", "New crew request");
  const links = [`/admin/tutor-requests#request-${tutorRequest.id}`, `/admin/crew#request-${crewRequest.id}`];
  const notices = await sourceNotices(links);
  expect(notices).toHaveLength(2);
  expect(notices.every((notice) => notice.userId === admin)).toBe(true);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 2, created: 0 });
  expect(await sourceNotices(links)).toEqual(notices);
});

it("reconciles every pending source across the bounded 100-row page boundary exactly once", async () => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  await db.tutorStatusRequest.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
    tutorId: source.tutor.id, kind: "OPT_OUT" as const, reason: `Retained separate historical intent ${index}`,
    eligibleAt: new Date("2099-01-01"),
  })) });
  const original = await db.tutorStatusRequest.findMany({ orderBy: { id: "asc" } });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 104, created: 104 });
  const notices = await db.notification.findMany({ where: { userId: admin } });
  expect(notices).toHaveLength(104);
  expect(new Set(notices.map((notice) => `${notice.event}:${notice.link}`)).size).toBe(104);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 104, created: 0 });
  expect(await db.tutorStatusRequest.findMany({ orderBy: { id: "asc" } })).toEqual(original);
  await expectDomainEvidencePreserved(source);
});

it("counts and repairs the shared approval queue together with all three domain queues", async () => {
  const source = await pendingDomainQueues();
  await db.user.update({ where: { id: requester }, data: { role: "COORDINATOR" } });
  const approval = await queueProposal(session(requester, "COORDINATOR"), "program.setTimeZone", {
    timeZone: "UTC", expectedTimeZone: "Asia/Shanghai",
  });
  const originalApprovalNotices = await requestNotices(approval.id);
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 4, created: 4 });
  const notices = await sourceNotices([...source.links, `/admin/approvals?request=${approval.id}`]);
  expect(notices.filter((notice) => notice.userId === admin)).toHaveLength(4);
  for (const notice of originalApprovalNotices)
    expect(await db.notification.findUniqueOrThrow({ where: { id: notice.id } })).toEqual(notice);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).toEqual(approval);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ pending: 4, created: 0 });
  await expectDomainEvidencePreserved(source);
});

it("appends current Admin review notices while preserving old Head notices and original evidence", async () => {
  const request = await legacyPending();
  const original = await requestNotices(request.id);
  expect(original.map((row) => row.userId)).toEqual([head]);
  // Model the policy deployment after an existing Admin account becomes eligible.
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  const repairs = await Promise.all([
    caller(admin, "ADMIN").notification.reconcileManagementReviews(),
    caller().notification.reconcileManagementReviews(),
  ]);
  expect(repairs.reduce((count, result) => count + result.created, 0)).toBe(1);
  const notices = await requestNotices(request.id);
  expect(notices.map((row) => row.userId).sort()).toEqual([head, admin].sort());
  expect(notices.find((row) => row.id === original[0]!.id)).toEqual(original[0]);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toEqual(request);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  expect(await requestNotices(request.id)).toEqual(notices);
});

it("retains the Head fallback without duplicate notices when there is no eligible Admin", async () => {
  const request = await legacyPending();
  const original = await requestNotices(request.id);
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  expect(await requestNotices(request.id)).toEqual(original);
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN", suspendedAt: new Date() } });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  expect((await requestNotices(request.id)).map((row) => row.userId)).toEqual([head]);
});

it("notifies a newly promoted Admin about existing pending work in the rank-change transaction", async () => {
  const request = await legacyPending();
  const original = await requestNotices(request.id);
  await caller().admin.setUserRole({ userId: admin, role: "ADMIN", confirmPassword: password });
  expect((await requestNotices(request.id)).map((row) => row.userId).sort()).toEqual([head, admin].sort());
  expect(await db.notification.findUniqueOrThrow({ where: { id: original[0]!.id } })).toEqual(original[0]);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toEqual(request);
  expect(await caller(admin, "ADMIN").notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
});

it.each(["inactive-requester", "incompatible-payload"] as const)("does not append actionable notices for %s legacy requests", async (scenario) => {
  let request = await legacyPending();
  const notices = await requestNotices(request.id);
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  if (scenario === "inactive-requester")
    await db.user.update({ where: { id: requester }, data: { suspendedAt: new Date() } });
  else request = await db.approvalRequest.update({ where: { id: request.id }, data: {
    payload: superjson.serialize({ removedLegacyField: true }) as unknown as Prisma.InputJsonValue,
  } });
  expect(await caller().notification.reconcileManagementReviews()).toMatchObject({ created: 0 });
  expect(await requestNotices(request.id)).toEqual(notices);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toEqual(request);
});

it("denies Coordinator reconciliation and keeps period activation notices with Head", async () => {
  await db.user.update({ where: { id: admin }, data: { role: "ADMIN" } });
  const snapshot = await caller().program.nextRecruitment();
  const request = await queueProposal(session(admin, "ADMIN"), "admin.refresh", {
    confirm: "REFRESH", expectedTermId: "notification-cutover-term",
    expectedPreparation: snapshot.refreshEvidence,
  });
  const notices = await requestNotices(request.id);
  expect(notices.map((row) => row.userId)).toEqual([head]);
  await expect(caller(coordinator, "HEAD").notification.reconcileManagementReviews()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller(admin, "ADMIN").notification.reconcileManagementReviews();
  expect(await requestNotices(request.id)).toEqual(notices);
  await expect(caller(admin, "ADMIN").approval.decide({ id: request.id, approve: true, note: "Admin cannot activate" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe("PENDING");
});
