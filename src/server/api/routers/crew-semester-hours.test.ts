import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error("Crew semester hours tests require local shbs_shipping_test");

let headId: string;
let crewId: string;
let tutorId: string;
let roomId: string;

const caller = (
  userId: string,
  role: Session["role"],
  linkedTutorId: string | null = null,
) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: userId, name: role },
      role,
      tutorId: linkedTutorId,
      expires: "2099-01-01",
    },
  });

async function refreshProgram() {
  const head = caller(headId, "HEAD");
  const snapshot = await head.program.nextRecruitment();
  const active = await db.term.findFirstOrThrow({ where: { active: true } });
  return head.admin.refresh({
    confirm: "REFRESH",
    expectedTermId: active.id,
    expectedPreparation: snapshot.refreshEvidence,
  });
}

async function submitPatrolAt(isoTime: string) {
  vi.setSystemTime(new Date(isoTime));
  return caller(crewId, "TUTOR", tutorId).crew.submitPatrol({
    submissionKey: randomUUID(),
    observations: [{ roomId, headcount: "TWO", observedAt: new Date(isoTime) }],
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-10T08:00:00Z"));
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  headId = (
    await db.user.create({
      data: { email: "head-crew-sem@example.test", name: "Head", role: "HEAD" },
    })
  ).id;
  tutorId = (
    await db.tutor.create({
      data: { englishName: "Crew Tutor", status: "ACTIVE" },
    })
  ).id;
  crewId = (
    await db.user.create({
      data: {
        email: "crew-sem@example.test",
        name: "Crew Tutor",
        role: "TUTOR",
        tutorId,
        crewStatus: "ACTIVE",
      },
    })
  ).id;
  roomId = (await db.room.create({ data: { name: "Room A101" } })).id;
  await db.term.create({
    data: { schoolYear: "26-27", quarter: "Q1", name: "26-27 Q1", active: true },
  });
});

afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

it("accumulates crew service hours across Q1 and Q2, flushes live totals at semester and school-year rollovers, and preserves history", async () => {
  const crew = caller(crewId, "TUTOR", tutorId);
  const head = caller(headId, "HEAD");

  // Untagged legacy patrols (termId: null) must never pollute an active semester's live counters.
  await db.patrol.create({
    data: { crewUserId: crewId, termId: null, hours: 4, note: "Legacy untagged" },
  });

  // Q1 (S1): 0.5h credited.
  expect((await submitPatrolAt("2026-09-10T08:00:00Z")).hours).toBe(0.5);
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "26-27 S1",
    schoolYear: "26-27",
    semester: "S1",
    myPatrols: 1,
    myHours: 0.5,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 1, hours: 0.5 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 1,
    hours: 0.5,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 1, hours: 0.5 });

  // Q1 -> Q2 (still S1): crew hours accumulate across the semester's two quarters.
  const q2 = await refreshProgram();
  expect(q2).toMatchObject({ schoolYear: "26-27", quarter: "Q2", crossedSemester: false });
  expect((await submitPatrolAt("2026-11-10T08:00:00Z")).hours).toBe(0.5);
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "26-27 S1",
    myPatrols: 2,
    myHours: 1,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 2, hours: 1 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 2,
    hours: 1,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 2, hours: 1 });

  // Q2 -> Q3 (crosses into S2): all live crew totals flush to 0 for 26-27 S2.
  const q3 = await refreshProgram();
  expect(q3).toMatchObject({ schoolYear: "26-27", quarter: "Q3", crossedSemester: true });
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "26-27 S2",
    schoolYear: "26-27",
    semester: "S2",
    myPatrols: 0,
    myHours: 0,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 0, hours: 0 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 0,
    hours: 0,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 0, hours: 0 });

  // New patrol in Q3 counts only toward S2 while S1 history and reports remain intact.
  expect((await submitPatrolAt("2027-02-10T08:00:00Z")).hours).toBe(0.5);
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "26-27 S2",
    myPatrols: 1,
    myHours: 0.5,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 1, hours: 0.5 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 1,
    hours: 0.5,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 1, hours: 0.5 });

  // Recent patrol history and historical S1 period report preserve every S1 patrol.
  expect(await crew.crew.myPatrols()).toHaveLength(4);
  const s1Report = await head.admin.periodReport({
    schoolYear: "26-27",
    semester: "S1",
    depth: "detailed",
  });
  expect(s1Report.summary.counts.patrols).toBe(2);
  expect(s1Report.crewStats).toEqual([
    expect.objectContaining({ userId: crewId, patrols: 2, hours: 1 }),
  ]);

  // Q3 -> Q4 (still S2) retains S2 hours; Q4 -> 27-28 Q1 (new school year S1) flushes again.
  await refreshProgram();
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "26-27 S2",
    myPatrols: 1,
    myHours: 0.5,
  });
  const nextYear = await refreshProgram();
  expect(nextYear).toMatchObject({
    schoolYear: "27-28",
    quarter: "Q1",
    crossedSemester: true,
    crossedYear: true,
  });
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: "27-28 S1",
    schoolYear: "27-28",
    semester: "S1",
    myPatrols: 0,
    myHours: 0,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 0, hours: 0 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 0,
    hours: 0,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 0, hours: 0 });
});

it("returns zeroed crew totals when no active term exists", async () => {
  await db.patrol.create({
    data: { crewUserId: crewId, termId: null, hours: 1.5 },
  });
  await db.term.updateMany({ data: { active: false } });

  const crew = caller(crewId, "TUTOR", tutorId);
  const head = caller(headId, "HEAD");
  expect(await crew.crew.patrolConfig()).toMatchObject({
    periodLabel: null,
    schoolYear: null,
    semester: null,
    myPatrols: 0,
    myHours: 0,
  });
  expect(await crew.tutor.myCrew()).toEqual({ isCrew: true, patrols: 0, hours: 0 });
  expect((await head.admin.crewRoster()).find((r) => r.id === crewId)).toMatchObject({
    patrols: 0,
    hours: 0,
  });
  expect(await head.admin.crewSummary()).toMatchObject({ patrols: 0, hours: 0 });
});
