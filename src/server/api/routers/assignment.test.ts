import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { approveQualification } from "~/server/qualifications";
import { ApprovalQueued } from "~/server/approvals";

// This suite resets fixtures only after the repository's loopback database guard passes.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const actor = (id = "assignment-admin", role: Session["role"] = "ADMIN") => createCaller({
  db, headers: new Headers(), session: { user: { id, name: id, email: `${id}@example.test` }, role, tutorId: null, expires: "2099-01-01T00:00:00Z" },
});
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((t) => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: [
    { id: "assignment-admin", role: "ADMIN", email: "assignment-admin@example.test" },
    { id: "assignment-reviewer", role: "ADMIN", email: "assignment-reviewer@example.test" },
    { id: "assignment-coordinator", role: "COORDINATOR", email: "assignment-coordinator@example.test" },
    { id: "assignment-viewer", role: "VIEWER", email: "assignment-viewer@example.test" },
    { id: "assignment-tutor", role: "TUTOR", email: "assignment-tutor@example.test" },
  ] });
  await db.term.create({ data: { name: "Assignment Test", schoolYear: "26-27", quarter: "Q1", active: true } });
});
afterAll(() => db.$disconnect());

async function fixture() {
  const tutor = await db.tutor.create({ data: { englishName: "Synthetic Ada", status: "ACTIVE" } });
  const subject = await db.subject.create({ data: { name: "Synthetic Mathematics" } });
  const slot = await db.timeSlot.create({ data: { label: "Synthetic Monday", dayOfWeek: 1, startMin: 900, endMin: 960 } });
  return { tutor, subject, input: { tutorId: tutor.id, subjectId: subject.id, subject: subject.name, timeSlotId: slot.id, tuteeIds: [] as string[] } };
}
async function ready(id: string) {
  // Boundary timing itself is exercised with a fake clock in the domain/UI tests.
  await db.studentActionConfirmation.update({ where: { id }, data: { readyAt: new Date(Date.now() - 1) } });
}

it("enforces permission checks on preparation and direct assignment", async () => {
  const { input } = await fixture();
  for (const [id, role] of [["assignment-viewer", "VIEWER"], ["assignment-tutor", "TUTOR"]] as const) {
    await expect(actor(id, role).assignment.prepare({ operation: "admin.createPairing", payload: input })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(actor(id, role).admin.createPairing(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(actor().admin.createPairing(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.pairing.count()).toBe(0);
});

it("approved persisted grants group correctly and assign without an override", async () => {
  const { tutor, subject, input } = await fixture();
  await db.$transaction((tx) => approveQualification(tx, tutor.id, subject.id, "assignment-admin"));
  expect(await actor().assignment.grants()).toContainEqual({ tutorId: tutor.id, subjectId: subject.id });
  expect(await actor().assignment.prepare({ operation: "admin.createPairing", payload: input })).toEqual({ mismatches: [], ticket: null });
  await expect(actor().admin.createPairing(input)).resolves.toMatchObject({ tutorId: tutor.id, subject: subject.name });
});

it("rejects early, cancelled, reused, changed, and other-user tickets", async () => {
  const { input } = await fixture();
  const prepared = await actor().assignment.prepare({ operation: "admin.createPairing", payload: input });
  const overrideTicket = prepared.ticket!.id;
  expect(prepared.mismatches).toHaveLength(1);
  await expect(actor().admin.createPairing({ ...input, overrideTicket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await ready(overrideTicket);
  await expect(actor("assignment-reviewer").admin.createPairing({ ...input, overrideTicket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const other = await db.tutor.create({ data: { englishName: "Synthetic Ben", status: "ACTIVE" } });
  await expect(actor().admin.createPairing({ ...input, tutorId: other.id, overrideTicket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await actor().assignment.cancel({ ticket: overrideTicket });
  await expect(actor().admin.createPairing({ ...input, overrideTicket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const reopened = await actor().assignment.prepare({ operation: "admin.createPairing", payload: input });
  await ready(reopened.ticket!.id);
  await actor().admin.createPairing({ ...input, overrideTicket: reopened.ticket!.id });
  await expect(actor().admin.createPairing({ ...input, overrideTicket: reopened.ticket!.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.pairing.count()).toBe(1);
});

it("preserves scheduling rejection and rolls back consumption on failure", async () => {
  const { input } = await fixture();
  const room = await db.room.create({ data: { name: "Synthetic room" } });
  await db.roomUnavailability.create({ data: { roomId: room.id, dayOfWeek: 1, startMin: 900, endMin: 960 } });
  const payload = { ...input, roomId: room.id };
  const prepared = await actor().assignment.prepare({ operation: "admin.createPairing", payload });
  await ready(prepared.ticket!.id);
  await expect(actor().admin.createPairing({ ...payload, overrideTicket: prepared.ticket!.id })).rejects.toThrow();
  expect(await db.pairing.count()).toBe(0);
  expect((await db.studentActionConfirmation.findUniqueOrThrow({ where: { id: prepared.ticket!.id } })).usedAt).toBeNull();
});

it("rejects a level archived after its warning without consuming the acknowledgement", async () => {
  const { subject, input } = await fixture();
  const level = await db.subjectLevel.create({ data: { name: "Synthetic level", rank: 1 } });
  await db.subject.update({ where: { id: subject.id }, data: { levelId: level.id } });
  const prepared = await actor().assignment.prepare({ operation: "admin.createPairing", payload: input });
  await ready(prepared.ticket!.id);
  await db.subjectLevel.update({ where: { id: level.id }, data: { active: false } });
  await expect(actor().admin.createPairing({ ...input, overrideTicket: prepared.ticket!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.pairing.count()).toBe(0);
  expect((await db.studentActionConfirmation.findUniqueOrThrow({ where: { id: prepared.ticket!.id } })).usedAt).toBeNull();
});

it("rejects explicit membership revocation after warning and never restores access", async () => {
  const { tutor, input } = await fixture();
  await db.user.update({ where: { id: "assignment-tutor" }, data: { tutorId: tutor.id, tutorAccessRevoked: false } });
  const prepared = await actor().assignment.prepare({ operation: "admin.createPairing", payload: input });
  await ready(prepared.ticket!.id);
  await db.user.update({ where: { id: "assignment-tutor" }, data: { tutorAccessRevoked: true } });
  await expect(actor().admin.createPairing({ ...input, overrideTicket: prepared.ticket!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(actor().assignment.prepare({ operation: "admin.createPairing", payload: input })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.pairing.count()).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: "assignment-tutor" } })).tutorAccessRevoked).toBe(true);
});

it("requires fresh reviewer evidence and applies the override within the approval transaction", async () => {
  const { input } = await fixture();
  const coordinator = actor("assignment-coordinator", "COORDINATOR");
  const prepared = await coordinator.assignment.prepare({ operation: "admin.createPairing", payload: input });
  await ready(prepared.ticket!.id);
  await expect(coordinator.admin.createPairing({ ...input, overrideTicket: prepared.ticket!.id })).rejects.toMatchObject({ cause: expect.any(ApprovalQueued) });
  expect(await db.pairing.count()).toBe(0);
  const proposal = await db.approvalRequest.findFirstOrThrow();
  await expect(actor().approval.decide({ id: proposal.id, approve: true, note: "Review synthetic assignment" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const review = await actor().assignment.prepare({ operation: "admin.createPairing", payload: input });
  await ready(review.ticket!.id);
  await actor().approval.decide({ id: proposal.id, approve: true, note: "Confirmed qualification mismatch", overrideTicket: review.ticket!.id });
  expect(await db.pairing.count()).toBe(1);
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } })).state).toBe("APPROVED");
});
