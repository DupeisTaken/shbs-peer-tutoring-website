import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { currentPolicy } from "~/server/policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { ensureSessionPlanningWindow } from ".";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
function caller(id = "bridge-tutor", role: Session["role"] = "TUTOR") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: id },
      role,
      tutorId: role === "TUTOR" ? "bridge-tutor-profile" : null,
      expires: "2099-01-01",
    },
  });
}
const cohort = () =>
  db.sessionPlanCohort.findFirstOrThrow({ where: { date: "2026-10-26" } });
async function attendance() {
  const row = await cohort();
  return {
    cohortId: row.id,
    expectedCohortVersion: row.version,
    pairingId: "bridge-pairing",
    date: new Date("2026-10-26T00:00:00Z"),
    tutorStatus: "PRESENT" as const,
    startMin: 900,
    endMin: 950,
    online: true,
    comments: "Synthetic actual attendance",
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
    tutees: [{ tuteeId: "bridge-one", status: "PRESENT" as const }],
  };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
  await db.term.create({
    data: {
      id: "bridge-term",
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Synthetic",
      active: true,
    },
  });
  await db.tutor.create({
    data: {
      id: "bridge-tutor-profile",
      englishName: "Synthetic Tutor",
      status: "ACTIVE",
    },
  });
  await db.tutee.createMany({
    data: ["bridge-one", "bridge-two"].map((id) => ({
      id,
      englishName: id,
      status: "ACTIVE" as const,
    })),
  });
  await db.user.createMany({
    data: [
      {
        id: "bridge-tutor",
        tutorId: "bridge-tutor-profile",
        role: "TUTOR",
        email: "bridge-tutor@example.test",
      },
      {
        id: "bridge-one-user",
        studentId: "bridge-one",
        role: "STUDENT",
        tuteeMember: true,
        email: "bridge-one@example.test",
      },
      {
        id: "bridge-two-user",
        studentId: "bridge-two",
        role: "STUDENT",
        tuteeMember: true,
        email: "bridge-two@example.test",
      },
    ],
  });
  await db.pairing.create({
    data: {
      id: "bridge-pairing",
      termId: "bridge-term",
      tutorId: "bridge-tutor-profile",
      subject: "Math",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      scheduleConfirmed: true,
      tutees: {
        create: [{ tuteeId: "bridge-one" }, { tuteeId: "bridge-two" }],
      },
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic",
      body: "Synthetic policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: "bridge-tutor",
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic Tutor",
    },
  });
  await ensureSessionPlanningWindow(db);
  // Simulate one separately moved commitment: the recurring roster still contains both.
  await db.sessionPlanParticipant.updateMany({
    where: { cohortId: (await cohort()).id, tuteeId: "bridge-two" },
    data: { cohortId: null, status: "CANCELLED" },
  });
  vi.setSystemTime(new Date("2026-10-26T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => db.$disconnect());

it("records only the dated cohort, keeps actual duration and replays one immutable receipt", async () => {
  const payload = await attendance();
  const first = await caller().tutor.submitAttendance(payload);
  expect(await caller().tutor.submitAttendance(payload)).toEqual(first);
  const stored = await db.session.findUniqueOrThrow({
    where: { id: first.id },
    include: { tutees: true },
  });
  expect(stored.durationMin).toBe(50);
  expect(stored.timeSlotId).toBeNull();
  expect(stored.planningCohortId).toBe(payload.cohortId);
  expect(stored.tutees.map((t) => t.tuteeId)).toEqual(["bridge-one"]);
  expect((await cohort()).status).toBe("RECORDED");
  await expect(
    caller().tutor.submitAttendance({ ...payload, endMin: 955 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.session.count()).toBe(1);
});
it("rejects stale, early or fabricated attendance provenance without writes", async () => {
  const payload = await attendance();
  await expect(
    caller().tutor.submitAttendance({ ...payload, expectedCohortVersion: 99 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().tutor.submitAttendance({ ...payload, tutorStatus: "EXTRA" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  vi.setSystemTime(new Date("2026-10-26T06:00:00Z"));
  await expect(caller().tutor.submitAttendance(payload)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await db.session.count()).toBe(0);
});
it("derives extra and rescheduled provenance from the plan", async () => {
  const row = await cohort();
  await db.sessionPlan.update({
    where: { id: row.planId },
    data: { kind: "EXTRA" },
  });
  await db.sessionPlanCohort.update({
    where: { id: row.id },
    data: { rescheduled: true },
  });
  const result = await caller().tutor.submitAttendance(await attendance());
  const saved = await db.session.findUniqueOrThrow({
    where: { id: result.id },
    include: { planningCohort: { include: { plan: true } } },
  });
  expect(saved.tutorStatus).toBe("EXTRA");
  expect(saved.planningCohort?.rescheduled).toBe(true);
});
it("limits coordination contacts to current assigned counterparts and preserves explicit restrictions", async () => {
  const sessionCohortId = (await cohort()).id;
  const contacts = await caller().messaging.recipients({ sessionCohortId });
  expect(contacts.people.map((p) => p.id)).toEqual(["bridge-one-user"]);
  expect(await db.directMessage.count()).toBe(0);
  const send = {
    sessionCohortId,
    recipientIds: ["bridge-one-user"],
    body: "Could we agree on a time?",
    disclosureVersion: 1 as const,
    clientKey: randomUUID(),
  };
  await caller().messaging.send(send);
  await caller().messaging.send(send);
  expect(await db.directMessage.count()).toBe(1);
  expect(
    (
      await caller("bridge-one-user", "STUDENT").messaging.recipients({
        sessionCohortId,
      })
    ).people.map((p) => p.id),
  ).toEqual(["bridge-tutor"]);
  expect(
    (
      await caller("bridge-two-user", "STUDENT").messaging.recipients({
        sessionCohortId,
      })
    ).people,
  ).toEqual([]);
  await db.messagePermission.create({
    data: { scope: "USER:bridge-tutor", groups: [] },
  });
  expect(
    (await caller().messaging.recipients({ sessionCohortId })).people,
  ).toEqual([]);
  await expect(
    caller().messaging.send({ ...send, clientKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
