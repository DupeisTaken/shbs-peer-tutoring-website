import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { lockEntity, inTransaction, type TransactionDb } from "./transactions";
import { lockUsernameNamespace } from "./auth/username";
import { lockCatalogue } from "./qualifications";
import { lockAccountProfile } from "./account-profile";
import { lockStudentRequestReview } from "./request-invalidity";
import { notifyRequest } from "./student-request-state";
import { currentPolicy } from "./policy-acceptance";
import { prepareStudentAction, resolveStudentReview } from "./student-workflow";
import {
  attemptContinuationAssignment,
  reconcileTutorContinuations,
  reconcileStudentContinuations,
  lockTutorContinuationRequests,
} from "./student-continuation-assignment";
import { sessionCalendarFeed } from "./session-planning-calendar";
import {
  ensureSessionPlanningWindow,
  lockSessionPlanning,
  proposeSession,
  respondSession,
  readSessionAgenda,
  sessionAttendanceContext,
  markSessionCohortRecorded,
} from "./session-planning";

const now = new Date("2026-10-30T00:00:00Z");
async function locked<T>(work: (tx: TransactionDb) => Promise<T>) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    await lockSessionPlanning(tx);
    return work(tx);
  });
}
const join = (suffix = "one", joinedAt = now) =>
  locked((tx) =>
    attemptContinuationAssignment(tx, {
      surveyId: `survey-${suffix}`,
      tuteeId: suffix,
      sourcePairingId: "prior-pairing",
      sourceTuteeId: `old-${suffix}`,
      targetTermId: "target",
      now: joinedAt,
    }),
  );
async function removeAvailability() {
  return locked(async (tx) => {
    await tx.tutorAvailability.deleteMany({ where: { tutorId: "tutor" } });
    return reconcileTutorContinuations(tx, "tutor", now);
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
        .join(",") +
      " CASCADE",
  );
  await db.term.createMany({
    data: [
      { id: "prior", name: "Prior", schoolYear: "26-27", quarter: "Q1" },
      {
        id: "target",
        name: "Target",
        schoolYear: "26-27",
        quarter: "Q2",
        active: true,
        startDate: new Date("2026-10-26T00:00:00Z"),
        endDate: new Date("2026-12-01T00:00:00Z"),
      },
    ],
  });
  await db.subject.create({ data: { id: "math", name: "Math" } });
  await db.timeSlot.create({
    data: {
      id: "slot",
      label: "Monday",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.room.createMany({
    data: [
      { id: "room-a", name: "Synthetic A" },
      { id: "room-b", name: "Synthetic B" },
    ],
  });
  await db.tutor.create({
    data: { id: "tutor", englishName: "Synthetic Tutor", status: "ACTIVE" },
  });
  await db.user.createMany({
    data: [
      { id: "admin", email: "admin@example.test", role: "ADMIN" },
      {
        id: "tutor-user",
        email: "tutor@example.test",
        tutorId: "tutor",
        role: "TUTOR",
        emailVerifiedAt: now,
      },
    ],
  });
  await db.tutorQualification.create({
    data: {
      tutorId: "tutor",
      subjectId: "math",
      status: "APPROVED",
      approvedById: "admin",
      grants: { create: { subjectId: "math" } },
    },
  });
  await db.tutorSubjectWillingness.create({
    data: { tutorId: "tutor", subjectId: "math", willing: true },
  });
  await db.tutorAvailability.create({
    data: { tutorId: "tutor", slotId: "slot" },
  });
  for (const suffix of ["one", "two"]) {
    await db.tutee.createMany({
      data: [
        {
          id: `old-${suffix}`,
          englishName: `Prior ${suffix}`,
          status: "ACTIVE",
          intakeTermId: "prior",
          firstChoiceId: "math",
        },
        {
          id: suffix,
          englishName: `Current ${suffix}`,
          status: "PENDING",
          intakeTermId: "target",
          firstChoiceId: "math",
        },
      ],
    });
    await db.user.create({
      data: {
        id: `${suffix}-user`,
        email: `${suffix}@example.test`,
        role: "STUDENT",
        tuteeMember: true,
        studentId: suffix,
        emailVerifiedAt: now,
      },
    });
    await db.studentProfileOwnership.createMany({
      data: [
        { tuteeId: suffix, userId: `${suffix}-user` },
        { tuteeId: `old-${suffix}`, userId: `${suffix}-user` },
      ],
    });
    await db.studentSurvey.create({
      data: {
        id: `survey-${suffix}`,
        email: `${suffix}@example.test`,
        intakeTermId: "target",
        tuteeId: suffix,
        confirmedAt: now,
        submittedAt: now,
        tokenHash: `synthetic-${suffix}`,
        expiresAt: new Date("2026-12-01T00:00:00Z"),
        payload: { firstChoiceId: "math", slotIds: ["slot"] },
        policyRevision: "synthetic",
        policySnapshot: {},
      },
    });
  }
  await db.pairing.create({
    data: {
      id: "prior-pairing",
      tutorId: "tutor",
      termId: "prior",
      subject: "Math",
      timeSlotId: "slot",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      scheduleConfirmed: true,
      tutees: { create: [{ tuteeId: "old-one" }, { tuteeId: "old-two" }] },
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Synthetic rules",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: "tutor-user",
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic Tutor",
    },
  });
});
afterAll(() => db.$disconnect());
afterEach(() => vi.useRealTimers());

it("restores the weekly interval, shares one target pairing, and preserves original publication when a second learner joins", async () => {
  const first = await join();
  expect(first.state).toBe("ASSIGNED");
  await ensureSessionPlanningWindow(db, now);
  const before = await db.sessionPlan.findMany({
    orderBy: { id: "asc" },
    include: { assignments: true, cohorts: true },
  });
  const second = await join("two");
  expect(second).toMatchObject({
    state: "ASSIGNED",
    targetPairingId: first.targetPairingId,
  });
  expect(await join("two")).toEqual(second);
  await ensureSessionPlanningWindow(db, now);
  expect(await db.pairing.count({ where: { termId: "target" } })).toBe(1);
  expect(
    await db.pairing.findUnique({ where: { id: first.targetPairingId! } }),
  ).toMatchObject({ startMin: 900, endMin: 960 });
  const after = await db.sessionPlan.findMany({
    orderBy: { id: "asc" },
    include: { assignments: true, cohorts: true, participants: true },
  });
  expect(after.map((plan) => plan.id)).toEqual(before.map((plan) => plan.id));
  expect(after.map((plan) => plan.assignments)).toEqual(
    before.map((plan) => plan.assignments),
  );
  for (const plan of after) {
    expect(plan.cohorts).toHaveLength(1);
    expect(plan.cohorts[0]!.endMin - plan.cohorts[0]!.startMin).toBe(45);
    expect(plan.participants.map((person) => person.tuteeId).sort()).toEqual([
      "one",
      "two",
    ]);
    expect(plan.participants.every((person) => !person.scheduleOverride)).toBe(
      true,
    );
  }
  expect(
    await db.pairingTutee.count({ where: { pairingId: "prior-pairing" } }),
  ).toBe(2);
});

it("gives a late learner the future weekly default after peers completed an earlier agreed move", async () => {
  const first = await join();
  await ensureSessionPlanningWindow(db, now);
  const source = await db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02" },
  });
  const proposal = await proposeSession(
    db,
    { id: "tutor-user", tutorId: "tutor" },
    {
      cohortId: source.id,
      expectedVersion: source.version,
      clientKey: randomUUID(),
      scope: "ALL",
      kind: "RESCHEDULE",
      date: "2026-10-30",
      startMin: 900,
      online: false,
    },
  );
  const request = await db.sessionPlanningRequest.findUniqueOrThrow({
    where: { id: proposal.id },
  });
  await respondSession(
    db,
    { id: "one-user" },
    {
      requestId: request.id,
      offerId: request.currentOfferId!,
      expectedVersion: request.version,
      clientKey: randomUUID(),
      decision: "ACCEPT",
    },
  );
  const later = new Date("2026-10-31T00:00:00Z");
  vi.setSystemTime(later);
  await locked((tx) => markSessionCohortRecorded(tx, source.id));
  const completed = await db.sessionPlanCohort.findUniqueOrThrow({
    where: { id: source.id },
  });
  const peer = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: { planId_tuteeId: { planId: source.planId, tuteeId: "one" } },
  });
  const actual = await db.session.create({
    data: {
      pairingId: first.targetPairingId!,
      tutorId: "tutor",
      planningCohortId: completed.id,
      date: new Date("2026-10-30T00:00:00Z"),
      startMin: completed.startMin,
      endMin: completed.endMin,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q2",
      durationMin: 45,
      shFactor: 1,
      shCount: 0.75,
      tutees: { create: { tuteeId: "one" } },
    },
    include: { tutees: true },
  });
  expect(await join("two", later)).toMatchObject({ state: "ASSIGNED" });
  await ensureSessionPlanningWindow(db, later);
  const newcomer = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: { planId_tuteeId: { planId: source.planId, tuteeId: "two" } },
    include: { cohort: true },
  });
  expect(newcomer).toMatchObject({
    status: "SCHEDULED",
    scheduleOverride: false,
    cohort: { date: "2026-11-02", startMin: 900, rescheduled: false },
  });
  expect(newcomer.cohortId).not.toBe(completed.id);
  expect(
    await db.sessionPlanCohort.findUnique({ where: { id: completed.id } }),
  ).toEqual(completed);
  expect(
    await db.sessionPlanParticipant.findUnique({ where: { id: peer.id } }),
  ).toEqual(peer);
  expect(
    await db.session.findUnique({
      where: { id: actual.id },
      include: { tutees: true },
    }),
  ).toEqual(actual);
  expect(
    await db.sessionPlanningRequest.findUnique({ where: { id: request.id } }),
  ).toMatchObject({ status: "ACCEPTED" });
});

it.each([false, true])(
  "reuses an exact agreed return only while its cohort is live (cancelled: %s)",
  async (cancelled) => {
    await join();
    await ensureSessionPlanningWindow(db, now);
    const original = await db.sessionPlanCohort.findFirstOrThrow({
      where: { date: "2026-11-02" },
    });
    const agreementIds: string[] = [];
    // Two real agreements return the same physical cohort to its weekly clock,
    // retaining rescheduled=true and the original learner's explicit override.
    for (const date of ["2026-11-03", "2026-11-02"]) {
      const current = await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: original.id },
      });
      const proposal = await proposeSession(
        db,
        { id: "tutor-user", tutorId: "tutor" },
        {
          cohortId: current.id,
          expectedVersion: current.version,
          clientKey: randomUUID(),
          scope: "ALL",
          kind: "RESCHEDULE",
          date,
          startMin: original.startMin,
          roomId: original.roomId ?? undefined,
          online: original.online,
        },
      );
      const request = await db.sessionPlanningRequest.findUniqueOrThrow({
        where: { id: proposal.id },
      });
      await respondSession(
        db,
        { id: "one-user" },
        {
          requestId: request.id,
          offerId: request.currentOfferId!,
          expectedVersion: request.version,
          clientKey: randomUUID(),
          decision: "ACCEPT",
        },
      );
      agreementIds.push(request.id);
    }
    if (cancelled) {
      await db.sessionPlanParticipant.update({
        where: { planId_tuteeId: { planId: original.planId, tuteeId: "one" } },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      await db.sessionPlanCohort.update({
        where: { id: original.id },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
    }
    const peer = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { planId_tuteeId: { planId: original.planId, tuteeId: "one" } },
    });
    const returned = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: original.id },
    });
    // An earlier ordinary source may already have been retired. Its unchanged
    // clock must not let enrollment revive that canceled physical event.
    const tombstone = await db.sessionPlanCohort.create({
      data: {
        ...original,
        id: randomUUID(),
        status: "CANCELLED",
        sourceInvalidated: false,
      },
    });
    const agreements = await db.sessionPlanningRequest.findMany({
      where: { id: { in: agreementIds } },
      orderBy: { id: "asc" },
    });
    const assignments = await db.sessionPlanAssignment.findMany({
      where: { planId: original.planId },
    });
    expect(peer.scheduleOverride).toBe(true);
    expect(returned.rescheduled).toBe(true);
    expect(agreements.every((request) => request.status === "ACCEPTED")).toBe(
      true,
    );

    expect(await join("two")).toMatchObject({ state: "ASSIGNED" });
    await ensureSessionPlanningWindow(db, now);
    const newcomer = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { planId_tuteeId: { planId: original.planId, tuteeId: "two" } },
      include: { cohort: true },
    });
    expect(newcomer).toMatchObject({
      status: "SCHEDULED",
      scheduleOverride: false,
      cohort: {
        date: original.date,
        startMin: original.startMin,
        roomId: original.roomId,
        online: original.online,
      },
    });
    expect(newcomer.cohortId).not.toBe(tombstone.id);
    expect(
      await db.sessionPlanCohort.findUnique({ where: { id: tombstone.id } }),
    ).toEqual(tombstone);
    if (cancelled) {
      expect(newcomer.cohortId).not.toBe(returned.id);
      expect(
        await db.sessionPlanCohort.findUnique({ where: { id: returned.id } }),
      ).toEqual(returned);
    } else {
      expect(newcomer.cohortId).toBe(returned.id);
      expect(
        await db.sessionPlanCohort.findUnique({ where: { id: returned.id } }),
      ).toEqual({
        ...returned,
        version: returned.version + 1,
        updatedAt: expect.any(Date),
      });
    }
    expect(
      await db.sessionPlanCohort.count({
        where: { planId: original.planId, status: "SCHEDULED" },
      }),
    ).toBe(1);
    expect(
      await db.sessionPlanParticipant.findUnique({ where: { id: peer.id } }),
    ).toEqual(peer);
    expect(
      await db.sessionPlanningRequest.findMany({
        where: { id: { in: agreementIds } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(agreements);
    expect(
      await db.sessionPlanAssignment.findMany({
        where: { planId: original.planId },
      }),
    ).toEqual(assignments);
  },
);

it("keeps a late learner's source reserved when an earlier ALL audience counters", async () => {
  await join();
  await ensureSessionPlanningWindow(db, now);
  const source = await db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02" },
  });
  const proposal = await proposeSession(
    db,
    { id: "tutor-user", tutorId: "tutor" },
    {
      cohortId: source.id,
      expectedVersion: source.version,
      clientKey: randomUUID(),
      scope: "ALL",
      kind: "RESCHEDULE",
      date: "2026-11-03",
      startMin: 900,
      online: false,
    },
  );
  const request = await db.sessionPlanningRequest.findUniqueOrThrow({
    where: { id: proposal.id },
  });
  expect(await join("two")).toMatchObject({ state: "ASSIGNED" });
  const newcomer = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: { planId_tuteeId: { planId: source.planId, tuteeId: "two" } },
  });
  const counter = {
    requestId: request.id,
    offerId: request.currentOfferId!,
    expectedVersion: request.version,
    clientKey: randomUUID(),
    decision: "REJECT" as const,
    alternative: { date: "2026-11-02", startMin: 915, online: false },
  };
  await expect(
    respondSession(db, { id: "one-user" }, counter),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.sessionPlanningRequest.findUnique({ where: { id: request.id } }),
  ).toEqual(request);
  expect(
    await db.sessionPlanParticipant.findUnique({ where: { id: newcomer.id } }),
  ).toEqual(newcomer);
  expect(
    await db.sessionPlanCohort.count({
      where: { planId: source.planId, status: "SCHEDULED" },
    }),
  ).toBe(1);

  // The frozen audience can still negotiate a nonoverlapping move; the new
  // learner keeps their ordinary Monday lesson and never inherits that consent.
  await respondSession(
    db,
    { id: "one-user" },
    {
      ...counter,
      clientKey: randomUUID(),
      alternative: { date: "2026-11-02", startMin: 960, online: false },
    },
  );
  const changed = await db.sessionPlanningRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  await respondSession(
    db,
    { id: "tutor-user", tutorId: "tutor" },
    {
      requestId: changed.id,
      offerId: changed.currentOfferId!,
      expectedVersion: changed.version,
      clientKey: randomUUID(),
      decision: "ACCEPT",
    },
  );
  expect(
    await db.sessionPlanningRequest.findUnique({ where: { id: request.id } }),
  ).toMatchObject({ status: "ACCEPTED" });
  expect(
    await db.sessionPlanParticipant.findUnique({ where: { id: newcomer.id } }),
  ).toEqual(newcomer);
  const moved = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: { planId_tuteeId: { planId: source.planId, tuteeId: "one" } },
    include: { cohort: true },
  });
  expect(moved).toMatchObject({
    scheduleOverride: true,
    cohort: { date: "2026-11-02", startMin: 960 },
  });
});

it("replaces manual roster revisions without duplicating or reviving earlier continuation publications", async () => {
  const joined = await join();
  const pairingId = joined.targetPairingId!;
  await db.tutee.create({
    data: {
      id: "staff-peer",
      englishName: "Synthetic Staff Peer",
      status: "ACTIVE",
      intakeTermId: "target",
      firstChoiceId: "math",
    },
  });
  const live = () =>
    db.sessionPlanCohort.findMany({
      where: { date: "2026-11-02", status: "SCHEDULED" },
      include: { participants: true },
    });
  await ensureSessionPlanningWindow(db, now);
  const original = await live();
  expect(original).toHaveLength(1);
  const superseded = [original[0]!.planId];
  // Add, remove, and restore a staff-assigned peer after publication. Returning
  // to an older roster must publish a new revision, not revive its tombstone.
  for (const add of [true, false, true]) {
    if (add)
      await db.pairingTutee.create({
        data: { pairingId, tuteeId: "staff-peer" },
      });
    else
      await db.pairingTutee.delete({
        where: { pairingId_tuteeId: { pairingId, tuteeId: "staff-peer" } },
      });
    await ensureSessionPlanningWindow(db, now);
    const current = await live();
    expect(current).toHaveLength(1);
    expect(superseded).not.toContain(current[0]!.planId);
    expect(
      current[0]!.participants.map((person) => person.tuteeId).sort(),
    ).toEqual(add ? ["one", "staff-peer"] : ["one"]);
    superseded.push(current[0]!.planId);
  }
  const latestId = superseded.pop()!;
  expect(await join("two")).toMatchObject({ state: "ASSIGNED" });
  await ensureSessionPlanningWindow(db, now);
  const withConsent = await live();
  expect(withConsent).toHaveLength(1);
  expect(withConsent[0]!.planId).toBe(latestId);
  expect(
    withConsent[0]!.participants.map((person) => person.tuteeId).sort(),
  ).toEqual(["one", "staff-peer", "two"]);
  expect(
    await db.sessionPlanParticipant.count({
      where: { planId: { in: superseded }, tuteeId: "two" },
    }),
  ).toBe(0);
  expect(
    await db.sessionPlanCohort.count({
      where: { planId: { in: superseded }, status: "SCHEDULED" },
    }),
  ).toBe(0);
  await removeAvailability();
  await ensureSessionPlanningWindow(db, now);
  await ensureSessionPlanningWindow(db, now);
  const released = await live();
  expect(released).toHaveLength(1);
  expect(released[0]!.planId).toBe(latestId);
  expect(
    released[0]!.participants
      .filter((person) => person.status === "SCHEDULED")
      .map((person) => person.tuteeId),
  ).toEqual(["staff-peer"]);
});

it("queues an unavailable selection without removing its signup request or creating an assignment", async () => {
  await db.tutorAvailability.deleteMany();
  expect(await join()).toMatchObject({
    state: "UNASSIGNED",
    reason: "SLOT_UNAVAILABLE",
    targetPairingId: null,
  });
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toMatchObject({ state: "OPEN", submittedAt: now });
  expect(await db.pairing.count({ where: { termId: "target" } })).toBe(0);
});

it("rejects weekly learner overlap before dated plans exist, including retained profile ownership", async () => {
  await db.tutor.create({
    data: { id: "other", englishName: "Other", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: "other-user",
      email: "other@example.test",
      tutorId: "other",
      role: "TUTOR",
    },
  });
  await db.pairing.create({
    data: {
      id: "other-pairing",
      tutorId: "other",
      termId: "target",
      subject: "Other",
      dayOfWeek: 1,
      startMin: 930,
      endMin: 975,
      scheduleConfirmed: true,
      roomMode: "NONE",
      tutees: { create: { tuteeId: "old-one" } },
    },
  });
  expect(await db.sessionPlan.count()).toBe(0);
  expect(await join()).toMatchObject({
    state: "UNASSIGNED",
    reason: "SCHEDULE_CONFLICT",
  });
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toMatchObject({ state: "OPEN" });
});

it("queues a new continuation without a room when automatic allocation is disabled", async () => {
  await db.programFeature.create({
    data: { key: "AUTO_ASSIGN_ROOMS", enabled: false },
  });
  expect(await join()).toMatchObject({
    state: "UNASSIGNED",
    reason: "ROOM_UNAVAILABLE",
  });
  expect(await db.pairing.count({ where: { termId: "target" } })).toBe(0);
});

it("serializes concurrent joins into one teaching block and never replays a released assignment", async () => {
  const joined = await Promise.all([join(), join("two")]);
  expect(joined.every((item) => item.state === "ASSIGNED")).toBe(true);
  expect(new Set(joined.map((item) => item.targetPairingId)).size).toBe(1);
  expect(
    await db.pairingTutee.count({
      where: { pairingId: joined[0].targetPairingId! },
    }),
  ).toBe(2);
  await removeAvailability();
  await db.tutorAvailability.create({
    data: { tutorId: "tutor", slotId: "slot" },
  });
  const retried = await Promise.all([join(), removeAvailability()]);
  expect(retried[0]).toMatchObject({ state: "RELEASED" });
  expect(
    await db.pairingTutee.count({ where: { pairing: { termId: "target" } } }),
  ).toBe(0);
});

it("waits for request notifications before locking the tutor account during availability release", async () => {
  await join();
  let setter = Promise.resolve({ released: 0 });
  try {
    await inTransaction(db, async (requestTx) => {
      const request = await requestTx.studentSurvey.findUniqueOrThrow({
        where: { id: "survey-one" },
      });
      await lockStudentRequestReview(requestTx, request);
      let setterPid = 0;
      setter = locked(async (setterTx) => {
        const [backend] = await setterTx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        setterPid = backend!.pid;
        await lockTutorContinuationRequests(setterTx, "tutor");
        await lockAccountProfile(setterTx, "tutor-user");
        await setterTx.tutorAvailability.deleteMany({
          where: { tutorId: "tutor" },
        });
        return reconcileTutorContinuations(setterTx, "tutor", now);
      });
      // Observe the real database wait, then exercise the legacy request action's
      // notification FK acquisition while its request lock is still held.
      await vi.waitFor(async () => {
        expect(setterPid).not.toBe(0);
        const [waiting] = await db.$queryRaw<
          { blocked: boolean }[]
        >`SELECT cardinality(pg_blocking_pids(${setterPid}::int)) > 0 AS blocked`;
        expect(waiting?.blocked).toBe(true);
      });
      await notifyRequest(requestTx, request, "student_withdrawal_pending");
    });
    expect(await setter).toEqual({ released: 1 });
    expect(
      await db.notification.count({
        where: { userId: "tutor-user", event: "student_withdrawal_pending" },
      }),
    ).toBe(1);
  } finally {
    await setter;
  }
});

it("a concurrent first opt-in and tutor removal cannot leave an invalid active assignment", async () => {
  await Promise.all([join(), removeAvailability()]);
  const receipt = await db.studentContinuationAssignment.findFirstOrThrow();
  expect(["UNASSIGNED", "RELEASED"]).toContain(receipt.status);
  expect(
    await db.pairingTutee.count({
      where: { tuteeId: "one", pairing: { termId: "target" } },
    }),
  ).toBe(0);
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toMatchObject({ state: "OPEN", submittedAt: now });
});

it("preserves an explicitly selected source group only with complete subject coverage", async () => {
  await db.subject.create({ data: { id: "science", name: "Science" } });
  await db.tutorQualification.create({
    data: {
      tutorId: "tutor",
      subjectId: "science",
      status: "APPROVED",
      approvedById: "admin",
      grants: { create: { subjectId: "science" } },
    },
  });
  await db.tutorSubjectWillingness.create({
    data: { tutorId: "tutor", subjectId: "science", willing: true },
  });
  const group = await db.pairingGroup.create({
    data: {
      tutorId: "tutor",
      termId: "prior",
      primaryPairingId: "prior-pairing",
    },
  });
  await db.pairing.update({
    where: { id: "prior-pairing" },
    data: { groupId: group.id },
  });
  await db.pairing.create({
    data: {
      id: "prior-science",
      groupId: group.id,
      tutorId: "tutor",
      termId: "prior",
      subject: "Science",
      timeSlotId: "slot",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      scheduleConfirmed: true,
      tutees: { create: [{ tuteeId: "old-one" }, { tuteeId: "old-two" }] },
    },
  });
  const first = await join();
  const second = await locked((tx) =>
    attemptContinuationAssignment(tx, {
      surveyId: "survey-one",
      tuteeId: "one",
      sourcePairingId: "prior-science",
      sourceTuteeId: "old-one",
      targetTermId: "target",
      now,
    }),
  );
  expect([first.state, second.state]).toEqual(["ASSIGNED", "ASSIGNED"]);
  const targets = await db.pairing.findMany({ where: { termId: "target" } });
  expect(targets[0]!.groupId).toBeTruthy();
  expect(targets[0]!.groupId).toBe(targets[1]!.groupId);
  await ensureSessionPlanningWindow(db, now);
  const plans = await db.sessionPlan.findMany({
    include: { assignments: true },
  });
  expect(new Set(plans.map((plan) => plan.originalDate)).size).toBe(
    plans.length,
  );
  expect(plans.every((plan) => plan.assignments.length === 2)).toBe(true);
  expect(await join("two")).toMatchObject({
    state: "UNASSIGNED",
    reason: "GROUP_REVIEW_REQUIRED",
  });
  expect(
    await db.pairingTutee.count({
      where: { tuteeId: "two", pairing: { termId: "target" } },
    }),
  ).toBe(0);
});

it("rolls back only the failed assignment while retaining its accepted receipt", async () => {
  const first = await join();
  await ensureSessionPlanningWindow(db, now);
  // A dated collision for the new learner is detected after recurring allocation.
  await db.tutor.create({
    data: { id: "other", englishName: "Other", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: "other-user",
      email: "other@example.test",
      tutorId: "other",
      role: "TUTOR",
    },
  });
  await db.pairing.create({
    data: {
      id: "other-pairing",
      tutorId: "other",
      termId: "target",
      subject: "Other",
      dayOfWeek: 2,
      startMin: 600,
      endMin: 645,
      scheduleConfirmed: true,
      roomMode: "NONE",
      tutees: { create: { tuteeId: "two" } },
    },
  });
  await db.tutee.update({ where: { id: "two" }, data: { status: "ACTIVE" } });
  await ensureSessionPlanningWindow(db, now);
  const other = await db.sessionPlanCohort.findFirstOrThrow({
    where: { plan: { tutorId: "other" }, date: "2026-11-03" },
  });
  await db.sessionPlanCohort.update({
    where: { id: other.id },
    data: {
      date: "2026-11-02",
      startMin: 900,
      endMin: 945,
      startsAt: new Date("2026-11-02T07:00:00Z"),
      endsAt: new Date("2026-11-02T07:45:00Z"),
      rescheduled: true,
    },
  });
  const second = await join("two");
  expect(second.state).toBe("UNASSIGNED");
  expect(
    await db.pairingTutee.count({
      where: { pairingId: first.targetPairingId!, tuteeId: "two" },
    }),
  ).toBe(0);
  expect(
    await db.sessionPlanContinuationMember.count({
      where: { assignmentId: second.assignmentId },
    }),
  ).toBe(0);
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-two" } }),
  ).toMatchObject({ state: "OPEN", submittedAt: now });
});

it("cancels only the continuing learner, preserves a peer's agreed move, and never resurrects on later reads", async () => {
  const joined = await join();
  // The peer is deliberately staff assigned, outside this continuation's ownership.
  await db.pairingTutee.create({
    data: { pairingId: joined.targetPairingId!, tuteeId: "two" },
  });
  await db.tutee.update({ where: { id: "two" }, data: { status: "ACTIVE" } });
  await ensureSessionPlanningWindow(db, now);
  const source = await db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02", plan: { tutorId: "tutor" } },
  });
  const originalEvidence = await db.sessionPlanAssignment.findMany({
    where: { planId: source.planId },
  });
  const request = await proposeSession(
    db,
    { id: "tutor-user", tutorId: "tutor" },
    {
      cohortId: source.id,
      expectedVersion: source.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "two",
      date: "2026-11-03",
      startMin: 900,
      online: false,
    },
  );
  const stored = await db.sessionPlanningRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  await respondSession(
    db,
    { id: "two-user" },
    {
      requestId: request.id,
      offerId: stored.currentOfferId!,
      expectedVersion: stored.version,
      clientKey: randomUUID(),
      decision: "ACCEPT",
    },
  );
  const peerBefore = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: { planId_tuteeId: { planId: source.planId, tuteeId: "two" } },
  });
  expect(await removeAvailability()).toEqual({ released: 1 });
  const notices = await db.notification.count({
    where: { event: "student_continuation_released" },
  });
  expect(notices).toBe(3);
  expect(await removeAvailability()).toEqual({ released: 0 });
  await db.tutorAvailability.create({
    data: { tutorId: "tutor", slotId: "slot" },
  });
  await locked((tx) => reconcileTutorContinuations(tx, "tutor", now));
  await ensureSessionPlanningWindow(db, now);
  await readSessionAgenda(db, { id: "two-user" }, "tutee", now);
  expect(
    await db.sessionPlanParticipant.findUnique({
      where: { id: peerBefore.id },
    }),
  ).toEqual(peerBefore);
  expect(
    await db.sessionPlanParticipant.findUnique({
      where: { planId_tuteeId: { planId: source.planId, tuteeId: "one" } },
    }),
  ).toMatchObject({ status: "CANCELLED", calendarSuppressed: false });
  expect(
    await db.sessionPlanAssignment.findMany({
      where: { planId: source.planId },
    }),
  ).toEqual(originalEvidence);
  expect(
    await db.notification.count({
      where: { event: "student_continuation_released" },
    }),
  ).toBe(notices);
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toMatchObject({ state: "OPEN", submittedAt: now });
  const peerCohort = await db.sessionPlanCohort.findUniqueOrThrow({
    where: { id: peerBefore.cohortId! },
  });
  expect(
    await locked((tx) =>
      sessionAttendanceContext(
        tx,
        { id: "tutor-user", tutorId: "tutor" },
        peerCohort.id,
        undefined,
        new Date("2026-11-04T00:00:00Z"),
      ),
    ),
  ).toMatchObject({ tuteeIds: ["two"] });
});

it("preserves a lesson already ended before release and retains actual attendance", async () => {
  const joined = await join();
  await ensureSessionPlanningWindow(db, now);
  const cohort = await db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02" },
  });
  const later = new Date("2026-11-03T00:00:00Z");
  await locked(async (tx) => {
    await tx.tutorAvailability.deleteMany();
    await reconcileTutorContinuations(tx, "tutor", later);
  });
  expect(
    await db.sessionPlanCohort.findUnique({ where: { id: cohort.id } }),
  ).toEqual(cohort);
  expect(
    await locked((tx) =>
      sessionAttendanceContext(
        tx,
        { id: "tutor-user", tutorId: "tutor" },
        cohort.id,
        undefined,
        later,
      ),
    ),
  ).toMatchObject({ pairingIds: [joined.targetPairingId], tuteeIds: ["one"] });
});

it("preserves an independent inactive decision when removing the last continued assignment", async () => {
  const joined = await join();
  await ensureSessionPlanningWindow(db, now);
  await db.tutee.update({ where: { id: "one" }, data: { status: "INACTIVE" } });
  expect(await removeAvailability()).toEqual({ released: 1 });
  expect(await db.tutee.findUnique({ where: { id: "one" } })).toMatchObject({
    status: "INACTIVE",
  });
  expect(
    await db.pairingTutee.count({
      where: { pairingId: joined.targetPairingId!, tuteeId: "one" },
    }),
  ).toBe(0);
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toMatchObject({ state: "OPEN" });
});

it("retires continuation tracking after approved withdrawal without reactivating participation", async () => {
  const joined = await join();
  await ensureSessionPlanningWindow(db, now);
  const future = await db.sessionPlanParticipant.findFirstOrThrow({
    where: { tuteeId: "one", cohort: { startsAt: { gt: now } } },
  });
  const actual = await db.session.create({
    data: {
      pairingId: joined.targetPairingId!,
      tutorId: "tutor",
      date: new Date("2026-10-29T00:00:00Z"),
      startMin: 900,
      endMin: 945,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q2",
      durationMin: 45,
      shFactor: 1,
      shCount: 0.75,
      tutees: { create: { tuteeId: "one" } },
    },
    include: { tutees: true },
  });
  const review = await db.studentRequestReview.create({
    data: {
      surveyId: "survey-one",
      kind: "STUDENT_ABORT",
      requestedByUserId: "one-user",
      reason: "Synthetic withdrawal",
    },
  });
  const ticket = await prepareStudentAction(db, "admin", "APPROVE", review.id);
  vi.setSystemTime(ticket.readyAt);
  await resolveStudentReview(db, "admin", review.id, true, ticket.id);
  const terminal = await db.studentSurvey.findUniqueOrThrow({
    where: { id: "survey-one" },
  });
  const block = await db.studentQuarterBlock.findUniqueOrThrow({
    where: {
      email_intakeTermId: { email: "one@example.test", intakeTermId: "target" },
    },
  });
  expect(terminal.state).toBe("ABORTED");
  expect(await db.tutee.findUnique({ where: { id: "one" } })).toMatchObject({
    status: "INACTIVE",
  });

  expect(await reconcileStudentContinuations(db, ticket.readyAt)).toEqual({
    released: 1,
  });
  expect(await reconcileStudentContinuations(db, ticket.readyAt)).toEqual({
    released: 0,
  });
  expect(
    await db.studentContinuationAssignment.findUnique({
      where: { id: joined.assignmentId },
    }),
  ).toMatchObject({ status: "RELEASED", reason: "SOURCE_CHANGED" });
  expect(await db.tutee.findUnique({ where: { id: "one" } })).toMatchObject({
    status: "INACTIVE",
  });
  expect(
    await db.studentSurvey.findUnique({ where: { id: terminal.id } }),
  ).toEqual(terminal);
  expect(
    await db.studentQuarterBlock.findUnique({ where: { id: block.id } }),
  ).toEqual(block);
  expect(
    await db.session.findUnique({
      where: { id: actual.id },
      include: { tutees: true },
    }),
  ).toEqual(actual);
  expect(
    await db.sessionPlanParticipant.findUnique({ where: { id: future.id } }),
  ).toMatchObject({ status: "CANCELLED", calendarSuppressed: false });
  const notices = await db.notification.findMany({
    where: { event: "student_continuation_released" },
  });
  expect(notices.length).toBeGreaterThan(0);
  expect(
    notices.every((notice) =>
      notice.body?.includes(
        "Existing participation decisions remain in effect.",
      ),
    ),
  ).toBe(true);
  expect(
    notices.some((notice) =>
      notice.body?.includes("retained for staff review"),
    ),
  ).toBe(false);
});

it("catches up a raw availability change, retains actual history, and sends a pending learner's ICS tombstone", async () => {
  const joined = await join();
  await ensureSessionPlanningWindow(db, now);
  const participant = await db.sessionPlanParticipant.findFirstOrThrow({
    where: { tuteeId: "one" },
  });
  const token = "a".repeat(43);
  await db.sessionCalendarToken.create({
    data: {
      userId: "one-user",
      tokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  const actual = await db.session.create({
    data: {
      id: "prior-actual",
      pairingId: "prior-pairing",
      tutorId: "tutor",
      date: new Date("2026-10-19T00:00:00Z"),
      startMin: 900,
      endMin: 960,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      tutees: { create: { tuteeId: "old-one" } },
    },
    include: { tutees: true },
  });
  const originalRequest = await db.studentSurvey.findUniqueOrThrow({
    where: { id: "survey-one" },
  });
  await db.tutorAvailability.deleteMany();
  expect(await reconcileStudentContinuations(db, now)).toEqual({ released: 1 });
  expect(await reconcileStudentContinuations(db, now)).toEqual({ released: 0 });
  const calendar = await sessionCalendarFeed(db, token, now);
  expect(calendar).toContain(`commitment-${participant.id}@shbs-session`);
  expect(calendar).toContain("STATUS:CANCELLED");
  expect(
    await db.session.findUnique({
      where: { id: actual.id },
      include: { tutees: true },
    }),
  ).toEqual(actual);
  expect(
    await db.studentSurvey.findUnique({ where: { id: "survey-one" } }),
  ).toEqual(originalRequest);
  expect(
    await db.pairing.findUnique({ where: { id: joined.targetPairingId! } }),
  ).toMatchObject({ scheduleConfirmed: false, roomId: null });
  expect(
    await db.sessionNotice.count({
      where: { recipientUserId: "one-user", event: "cancelled" },
    }),
  ).toBeGreaterThan(0);
});
