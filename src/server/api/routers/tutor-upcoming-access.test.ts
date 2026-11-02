import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { tutorUpcoming } from "~/lib/tutor-upcoming";

// These destructive fixtures use only the batch's owned loopback test database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
let tutorId: string;
let applicationId: string;
const now = new Date("2026-10-18T07:30:00Z");
const caller = (id = "owner") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role: "TUTOR",
      tutorId,
      expires: "2099-01-01T00:00:00Z",
    },
  });
beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((r) => '"' + r.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  // This fixture intentionally teaches on a Sunday make-up school day.
  await db.schoolCalendarDay.create({ data: { date: "2026-10-18", isSchoolDay: true } });
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic schedule owner" },
  });
  tutorId = tutor.id;
  const other = await db.tutor.create({
    data: { englishName: "Synthetic other panelist" },
  });
  await db.user.createMany({
    data: [
      { id: "owner", email: "owner@example.test", role: "TUTOR", tutorId },
      {
        id: "other",
        email: "other@example.test",
        role: "TUTOR",
        tutorId: other.id,
      },
      { id: "unlinked", email: "unlinked@example.test", role: "VIEWER" },
    ],
  });
  const current = await db.term.create({
    data: {
      name: "Synthetic current",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const prior = await db.term.create({
    data: { name: "Synthetic prior", schoolYear: "25-26", quarter: "Q4" },
  });
  const student = await db.tutee.create({
    data: { englishName: "Synthetic assigned tutee", status: "ACTIVE" },
  });
  for (const [id, owner, termId, scheduleConfirmed] of [
    ["own", tutorId, current.id, true],
    ["prior", tutorId, prior.id, true],
    ["other", other.id, current.id, true],
    ["default", tutorId, current.id, false],
  ] as const) {
    await db.pairing.create({
      data: {
        id,
        tutorId: owner,
        termId,
        subject: "Synthetic subject",
        scheduleConfirmed,
        dayOfWeek: 7,
        startMin: 900,
        endMin: 960,
        tutees: { create: { tuteeId: student.id } },
      },
    });
  }
  const own = await db.tutorApplication.create({
    data: {
      name: "Synthetic own applicant",
      email: "own@example.test",
      interviewAt: new Date("2026-10-18T08:00:00Z"),
      interviewers: { create: { tutorId } },
    },
  });
  applicationId = own.id;
  await db.tutorApplication.create({
    data: {
      name: "Synthetic private other applicant",
      email: "private-other@example.test",
      interviewAt: now,
      interviewers: { create: { tutorId: other.id } },
    },
  });
});
afterAll(() => db.$disconnect());
it("projects only live owned active-period plans and never adds interview evidence to the room grid", async () => {
  const own = caller();
  const pairings = await own.tutor.myPairings();
  const interviews = await own.tutor.myInterviews();
  expect(pairings.map((p) => p.id).sort()).toEqual(["default", "own"]);
  expect(interviews.map((i) => i.id)).toEqual([applicationId]);
  const result = tutorUpcoming({
    pairings,
    interviews,
    schoolCalendar: await own.program.schoolCalendar({ from: "2026-10-18", to: "2026-10-24" }),
    now,
    timeZone: "Asia/Shanghai",
  });
  expect(result.events.map((e) => e.kind)).toEqual(["session", "interview"]);
  const grid = JSON.stringify(await own.tutor.schedule());
  expect(grid).not.toContain("applicant");
  expect(grid).not.toContain("@example.test");
  expect(grid).not.toContain("Synthetic assigned tutee");
  expect(await db.session.count()).toBe(0);
  expect(await db.interviewVote.count()).toBe(0);
  expect(
    (
      await db.tutorApplication.findUniqueOrThrow({
        where: { id: applicationId },
      })
    ).status,
  ).toBe("PENDING");
});
it("reflects rescheduling and panel replacement on a new read without retained duplicates", async () => {
  const own = caller();
  const pairings = await own.tutor.myPairings();
  await db.tutorApplication.update({
    where: { id: applicationId },
    data: { interviewAt: new Date("2026-10-25T08:00:00Z") },
  });
  expect(
    tutorUpcoming({
      pairings,
      interviews: await own.tutor.myInterviews(),
      schoolCalendar: await own.program.schoolCalendar({ from: "2026-10-18", to: "2026-10-24" }),
      now,
      timeZone: "Asia/Shanghai",
    }).events,
  ).toHaveLength(1);
  await db.interviewAssignment.delete({
    where: { applicationId_tutorId: { applicationId, tutorId } },
  });
  expect(await own.tutor.myInterviews()).toEqual([]);
});
it("rechecks live account access even when the caller carries an old tutor session", async () => {
  await expect(caller("unlinked").tutor.myInterviews()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.user.update({ where: { id: "owner" }, data: { suspendedAt: now } });
  await expect(caller().tutor.myPairings()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
