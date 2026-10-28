import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "../root";
import { db } from "~/server/db";
import { ApprovalQueued } from "~/server/approvals";

const caller = (id: string, role: Session["role"]) => createCaller({
  db, headers: new Headers(),
  session: { user: { id, name: id, email: `${id}@example.test` }, role,
    tutorId: null, expires: "2099-01-01T00:00:00Z" },
});
const head = () => caller("governance-head", "HEAD");
const admin = () => caller("governance-admin", "ADMIN");
const coordinator = () => caller("governance-coordinator", "COORDINATOR");

async function queued(work: Promise<unknown>) {
  const error: unknown = await work.catch((error: unknown) => error);
  expect((error as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  const id = (error as { cause: ApprovalQueued }).cause.approvalId;
  return db.approvalRequest.findUniqueOrThrow({ where: { id } });
}

// This suite owns only the explicitly isolated local fixture database. Tests are serial.
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Governance tests require isolated local shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: [
    { id: "governance-head", email: "head@example.test", role: "HEAD", name: "Head" },
    { id: "governance-admin", email: "admin@example.test", role: "ADMIN", name: "Admin" },
    { id: "governance-other-admin", email: "other@example.test", role: "ADMIN", name: "Other Admin" },
    { id: "governance-suspended", email: "suspended@example.test", role: "ADMIN", name: "Suspended", suspendedAt: new Date() },
    { id: "governance-coordinator", email: "coordinator@example.test", role: "COORDINATOR", name: "Coordinator" },
  ] });
  await db.term.create({ data: { id: "governance-term", name: "Current period", schoolYear: "26-27", quarter: "Q1", active: true } });
});
afterAll(() => db.$disconnect());

it.each(["subject", "batch", "level", "groupImplicit", "groupExplicit", "slot"] as const)("reviews %s catalogue restoration with Admin while retaining direct Admin edits", async (kind) => {
  const level = await db.subjectLevel.create({ data: { name: "Standard", prefix: "", rank: 0 } });
  const group = await db.courseGroup.create({ data: { name: "Science", rank: 0 } });
  const subject = await db.subject.create({ data: { name: "Science", baseName: "Science", groupId: group.id, levelId: level.id } });
  const slot = await db.timeSlot.create({ data: { label: "Morning", dayOfWeek: 1, startMin: 480, endMin: 540 } });
  const edit = (by = admin()) => {
    if (kind === "subject") return by.admin.updateSubject({ id: subject.id, name: "Science", active: true });
    if (kind === "batch") return by.admin.batchUpdateSubjects({ ids: [subject.id], active: true });
    if (kind === "level") return by.admin.updateSubjectLevel({ id: level.id, active: true });
    if (kind === "slot") return by.admin.updateTimeSlot({ id: slot.id, label: "Morning", dayOfWeek: 1, startMin: 480, endMin: 540, active: true });
    return by.admin.saveCourseGroup({ id: group.id, name: "Science", offerings: [{ baseName: "Science", levelId: level.id, ...(kind === "groupExplicit" ? { subjectId: subject.id } : {}) }] });
  };
  const read = () => kind === "level" ? db.subjectLevel.findUniqueOrThrow({ where: { id: level.id } }) : kind === "slot" ? db.timeSlot.findUniqueOrThrow({ where: { id: slot.id } }) : db.subject.findUniqueOrThrow({ where: { id: subject.id } });
  const archive = () => kind === "level" ? db.subjectLevel.update({ where: { id: level.id }, data: { active: false } }) : kind === "slot" ? db.timeSlot.update({ where: { id: slot.id }, data: { active: false } }) : db.subject.update({ where: { id: subject.id }, data: { active: false } });
  // The same API remains direct for ordinary active catalogue edits.
  await edit();
  expect(await db.approvalRequest.count()).toBe(0);
  await archive();
  const request = await queued(edit(coordinator()));
  expect((await read()).active).toBe(false);
  await expect(coordinator().approval.decide({ id: request.id, approve: true, note: "Cannot restore applied catalogue state" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await admin().approval.decide({ id: request.id, approve: true, note: "Restore reviewed catalogue record" });
  expect((await read()).active).toBe(true);
  await archive();
  const stale = await queued(edit(coordinator()));
  if (kind === "level") await db.subjectLevel.update({ where: { id: level.id }, data: { name: "Changed level" } });
  else if (kind === "slot") await db.timeSlot.update({ where: { id: slot.id }, data: { label: "Changed slot" } });
  else await db.subject.update({ where: { id: subject.id }, data: { baseName: "Changed subject" } });
  await expect(head().approval.decide({ id: stale.id, approve: true, note: "Reject changed catalogue evidence" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await read()).active).toBe(false);
});

it("routes Coordinator intake changes to Admin and applies exactly once", async () => {
  const input = { audience: "tutor" as const, expectedTermId: "governance-term", enabled: false,
    opensAt: null, closesAt: null, previewUrl: null };
  const before = await db.term.findUniqueOrThrow({ where: { id: "governance-term" } });
  const request = await queued(coordinator().program.setSignupWindow(input));
  expect(await db.term.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  expect(await db.notification.findMany({ where: { link: { contains: request.id } }, select: { userId: true } }))
    .toEqual(expect.arrayContaining([{ userId: "governance-admin" }, { userId: "governance-other-admin" }]));
  await expect(coordinator().approval.decide({ id: request.id, approve: true, note: "Coordinator cannot review" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.approvalRequest.count()).toBe(1);
  await expect(coordinator().approval.decide({ id: request.id, approve: true, note: "Cannot review own sensitive change" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  await admin().approval.decide({ id: request.id, approve: true, note: "Reviewed recruitment consequences" });
  expect((await db.term.findUniqueOrThrow({ where: { id: before.id } })).tutorSignupEnabled).toBe(false);
  await expect(head().approval.decide({ id: request.id, approve: true, note: "Repeated decision" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.auditLog.count({ where: { approvalId: request.id } })).toBeGreaterThanOrEqual(2);
});

it("keeps daily operations direct for Admin and notifies every eligible reviewer for Coordinator requests", async () => {
  const room = await admin().admin.createRoom({ name: "Direct daily operation" });
  expect(await db.room.findUnique({ where: { id: room.id } })).not.toBeNull();
  const request = await queued(coordinator().admin.createRoom({ name: "Reviewed daily operation" }));
  const recipients = await db.notification.findMany({ where: { link: { contains: request.id } }, select: { userId: true } });
  expect(recipients.map(({ userId }) => userId).sort()).toEqual([
    "governance-admin", "governance-other-admin",
  ]);
  await admin().approval.decide({ id: request.id, approve: true, note: "Reviewed room addition" });
  expect(await db.room.count()).toBe(2);
});

it("reviews Coordinator profile edits with Admin while retaining self-service and stale-evidence protection", async () => {
  const person = await db.user.create({ data: { email: "person@example.test", name: "Original Person", firstName: "Original", lastName: "Person", role: "STUDENT" } });
  const input = { userId: person.id, name: "Updated Person", firstName: "Updated", lastName: "Person",
    alternativeNames: null, expectedProfileVersion: 0 };
  const request = await queued(coordinator().admin.updateAccountProfile(input));
  expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).name).toBe("Original Person");
  await expect(coordinator().approval.decide({ id: request.id, approve: true, note: "Admin cannot apply profile edit" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  await admin().approval.decide({ id: request.id, approve: true, note: "Confirmed the staff correction" });
  expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).firstName).toBe("Updated");
  const stale = await queued(coordinator().admin.updateAccountProfile({ ...input, name: "Pending Person", firstName: "Pending", expectedProfileVersion: 1 }));
  await db.user.update({ where: { id: person.id }, data: { profileVersion: { increment: 1 } } });
  await expect(head().approval.decide({ id: stale.id, approve: true, note: "Stale profile must be rejected" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
});

it("lets Admin issue management invitations and review Coordinator participation requests", async () => {
  await expect(coordinator().admin.issueRegistrationCode({ kind: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(coordinator().admin.issueRegistrationCode({ kind: "COORDINATOR" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await admin().admin.issueRegistrationCode({ kind: "ADMIN" });
  expect(await db.approvalRequest.count()).toBe(0);
  const invitation = await db.registrationCode.findFirstOrThrow();
  expect(invitation.kind).toBe("ADMIN");
  const evidence = await db.auditLog.findMany({ where: { entityId: invitation.id } });
  expect(evidence.some(({ operation }) => operation === "registration.issue")).toBe(true);
  expect(JSON.stringify(evidence)).not.toContain(invitation.code);
  const tutorRequest = await queued(coordinator().admin.issueRegistrationCode({ kind: "TUTOR" }));
  await admin().approval.decide({ id: tutorRequest.id, approve: true, note: "Authorized Tutor invitation" });
  expect(await db.registrationCode.count()).toBe(2);
});

it("refuses legacy undo for every role before an incomplete recovery can enter the queue", async () => {
  const announcement = await db.announcement.create({ data: { title: "Restorable announcement", body: "Synthetic notice" } });
  await head().admin.deleteAnnouncement({ id: announcement.id });
  const original = await db.auditLog.findFirstOrThrow({ where: { entityId: announcement.id } });
  for (const actor of [admin(), head(), coordinator()])
    await expect(actor.admin.undoAudit({ id: original.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.announcement.findUnique({ where: { id: announcement.id } })).toBeNull();
  expect((await db.auditLog.findUniqueOrThrow({ where: { id: original.id } })).undone).toBe(false);
  expect(await db.approvalRequest.count({ where: { operation: "admin.undoAudit" } })).toBe(0);
});
