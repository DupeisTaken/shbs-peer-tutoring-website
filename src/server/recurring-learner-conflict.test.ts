import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  ensureSessionPlanningWindow,
  readSessionAgenda,
} from "~/server/session-planning";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const now = new Date("2026-10-26T00:00:00Z");
const date = "2026-10-27";
type Tutor = { id: string; tutorId: string; pairingId: string };
let tutors: Tutor[];
let learner: { id: string; tuteeId: string };
let originalSlotId: string;
let adjacentSlotId: string;

function caller(tutor: Tutor) {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: tutor.id, name: "Synthetic recurring tutor" },
      role: "TUTOR",
      tutorId: tutor.tutorId,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  // Immutable planning/recovery evidence requires the guarded, disposable test DB.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
  const term = await db.term.create({
    data: {
      name: "Synthetic recurring learner boundary",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
      startDate: new Date("2026-10-26T00:00:00Z"),
      endDate: new Date("2026-11-06T00:00:00Z"),
    },
  });
  const tutee = await db.tutee.create({
    data: { englishName: "Synthetic shared learner", status: "ACTIVE" },
  });
  const account = await db.user.create({
    data: {
      email: "recurring-learner@example.test",
      studentId: tutee.id,
      tuteeMember: true,
      emailVerifiedAt: now,
    },
  });
  learner = { id: account.id, tuteeId: tutee.id };
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic tutor policy",
      body: "Synthetic recurring schedule policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  tutors = [];
  for (const index of [0, 1]) {
    const tutor = await db.tutor.create({
      data: { englishName: `Synthetic recurring tutor ${index}`, status: "ACTIVE" },
    });
    const user = await db.user.create({
      data: {
        email: `recurring-tutor-${index}@example.test`,
        tutorId: tutor.id,
        role: "TUTOR",
        emailVerifiedAt: now,
      },
    });
    await db.policyAcceptance.create({
      data: {
        userId: user.id,
        slug: "tutor-policy",
        revision: policy.revision,
        snapshot: policy.documents,
        signature: tutor.englishName,
      },
    });
    const pairing = await db.pairing.create({
      data: {
        tutorId: tutor.id,
        termId: term.id,
        subject: `Synthetic subject ${index}`,
        dayOfWeek: 2,
        startMin: 900,
        endMin: 945,
        scheduleConfirmed: false,
        roomMode: "NONE",
        tutees: { create: { tuteeId: tutee.id } },
      },
    });
    tutors.push({ id: user.id, tutorId: tutor.id, pairingId: pairing.id });
  }
  originalSlotId = (
    await db.timeSlot.create({
      data: { label: "Synthetic shared time", dayOfWeek: 2, startMin: 900, endMin: 945 },
    })
  ).id;
  adjacentSlotId = (
    await db.timeSlot.create({
      data: { label: "Synthetic adjacent time", dayOfWeek: 2, startMin: 945, endMin: 990 },
    })
  ).id;
});

afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

it("keeps overlapping recurring learner intent recoverable without publishing conflicting dated commitments", async () => {
  // The documented recurring boundary forbids independent tutor/room overlap;
  // this characterization adds no stronger learner rejection policy to that API.
  for (const tutor of tutors) {
    // Roster insertion advances the room/source token through its DB trigger.
    // Model a newly opened schedule intent by reading that authoritative token.
    const before = await db.pairing.findUniqueOrThrow({
      where: { id: tutor.pairingId },
      select: { roomVersion: true },
    });
    await expect(
      caller(tutor).tutor.setPairingSlot({
        pairingId: tutor.pairingId,
        slotId: originalSlotId,
        expectedRoomVersion: before.roomVersion,
      }),
    ).resolves.toMatchObject({ scheduleConfirmed: true, startMin: 900 });
    expect(await db.sessionPlan.count()).toBe(0);
  }

  await ensureSessionPlanningWindow(db, now);
  const published = await db.sessionPlanCohort.findMany({
    where: { date },
    include: { plan: { include: { assignments: true } } },
  });
  expect(published).toHaveLength(2);
  expect(published.filter((row) => row.status === "SCHEDULED")).toHaveLength(1);
  const unavailable = published.find((row) => row.sourceInvalidated)!;
  expect(unavailable).toMatchObject({ status: "CANCELLED", startMin: 900 });
  const blockedPairingId = unavailable.plan.assignments[0]!.pairingId;
  const blockedTutor = tutors.find((tutor) => tutor.pairingId === blockedPairingId)!;

  // Use the real learner reader, not a query against the stored cancellation alone.
  const agenda = await readSessionAgenda(db, learner, "tutee", now);
  expect(agenda.cohorts.find((row) => row.id === unavailable.id)).toMatchObject({
    unavailable: true,
    status: "CANCELLED",
    pairingIds: [blockedPairingId],
  });
  expect(
    await db.sessionNotice.count({
      where: {
        recipientUserId: learner.id,
        event: "cancelled",
        dedupeKey: { startsWith: `cohort:${unavailable.id}:` },
      },
    }),
  ).toBe(1);

  // Once a dated commitment exists, even another roomless recurring save must
  // respect the learner's reserved time. The normal writer also provides repair.
  const current = await db.pairing.findUniqueOrThrow({ where: { id: blockedPairingId } });
  await expect(
    caller(blockedTutor).tutor.setPairingSlot({
      pairingId: blockedPairingId,
      slotId: originalSlotId,
      expectedRoomVersion: current.roomVersion,
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "The weekly change conflicts with an agreed dated session.",
  });
  // Repair is a separately initiated choice after reviewing the current source;
  // it must not adopt a fresh token into the previous rejected intent.
  const repair = await db.pairing.findUniqueOrThrow({
    where: { id: blockedPairingId },
    select: { roomVersion: true },
  });
  await expect(
    caller(blockedTutor).tutor.setPairingSlot({
      pairingId: blockedPairingId,
      slotId: adjacentSlotId,
      expectedRoomVersion: repair.roomVersion,
    }),
  ).resolves.toMatchObject({ scheduleConfirmed: true, startMin: 945 });

  const repaired = (await readSessionAgenda(db, learner, "tutee", now)).cohorts.filter(
    (row) => row.date === date,
  );
  expect(repaired).toHaveLength(2);
  expect(repaired.every((row) => row.status === "SCHEDULED" && !row.unavailable)).toBe(true);
  expect(repaired.map((row) => [row.startMin, row.endMin])).toEqual([
    [900, 945],
    [945, 990],
  ]);
  expect(await db.session.count()).toBe(0);
  expect(await db.sessionPlanningRequest.count()).toBe(0);
});
