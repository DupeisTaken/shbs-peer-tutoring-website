import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { currentPolicy } from "~/server/policy-acceptance";
import {
  saveSchoolCalendar,
  resetSchoolCalendar,
} from "~/server/program/school-calendar";
import { assertRoomBlackoutAvailable } from "~/server/room-bookings";
import { changeSchoolDeparture } from "~/server/school-departure";
import * as transactionHelpers from "~/server/transactions";
import type { PlanningTime } from "~/lib/session-planning";
import { assertNoPublishedTuteeDeletion } from "./deletion-guards";
import {
  ensureSessionPlanningWindow,
  proposeSession,
  respondSession,
  suggestSessionTime,
  requestSeparateSession,
  formalizeSeparateSessions,
  markSessionResponseDelivered,
  sweepSessionPlanning,
  sessionAttendanceContext,
  readSessionAgenda,
} from ".";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const tutor = { id: "planning-tutor-user", tutorId: "planning-tutor" };
const one = { id: "planning-one-user" },
  two = { id: "planning-two-user" };
const now = new Date("2026-10-26T00:00:00Z");
function signal() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const time = (date = "2026-11-03") => ({ date, startMin: 900, online: false });
const read = (id: string) =>
  db.sessionPlanningRequest.findUniqueOrThrow({
    where: { id },
    include: { offers: { include: { responses: true } } },
  });
async function current(id: string) {
  const request = await read(id);
  return {
    request,
    offer: request.offers.find((offer) => offer.id === request.currentOfferId)!,
  };
}
async function source() {
  return db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02", plan: { tutorId: tutor.tutorId } },
  });
}
async function propose(
  scope: "ONE" | "ALL" = "ONE",
  kind: "RESCHEDULE" | "EXTRA" = "RESCHEDULE",
  date?: string,
) {
  const cohort = await source();
  return proposeSession(db, tutor, {
    cohortId: cohort.id,
    expectedVersion: cohort.version,
    clientKey: randomUUID(),
    scope,
    kind,
    tuteeId: "planning-one",
    ...time(date),
  });
}
async function respond(
  id: string,
  actor: { id: string },
  decision: "ACCEPT" | "REJECT",
  alternative?: PlanningTime,
) {
  const { request, offer } = await current(id);
  return respondSession(db, actor, {
    requestId: id,
    offerId: offer.id,
    expectedVersion: request.version,
    clientKey: randomUUID(),
    decision,
    alternative,
  });
}

async function returnOneToOrdinaryCohort() {
  const original = await source();
  const first = await propose();
  await respond(first.id, one, "ACCEPT");
  const participant = await db.sessionPlanParticipant.findUniqueOrThrow({
    where: {
      planId_tuteeId: { planId: original.planId, tuteeId: "planning-one" },
    },
  });
  const away = await db.sessionPlanCohort.findUniqueOrThrow({
    where: { id: participant.cohortId! },
  });
  const back = await proposeSession(db, tutor, {
    cohortId: away.id,
    expectedVersion: away.version,
    clientKey: randomUUID(),
    scope: "ONE",
    kind: "RESCHEDULE",
    tuteeId: "planning-one",
    date: original.date,
    startMin: original.startMin,
    roomId: original.roomId,
    online: original.online,
  });
  await respond(back.id, one, "ACCEPT");
  return { original, participantId: participant.id };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  // All destructive fixtures require the explicitly isolated local test database guard above.
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
  await db.term.create({
    data: {
      id: "planning-term",
      name: "Synthetic",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-12-01T00:00:00Z"),
    },
  });
  await db.tutor.create({
    data: {
      id: tutor.tutorId,
      englishName: "Synthetic Tutor",
      status: "ACTIVE",
    },
  });
  await db.tutee.createMany({
    data: [
      { id: "planning-one", englishName: "Synthetic One", status: "ACTIVE" },
      { id: "planning-two", englishName: "Synthetic Two", status: "ACTIVE" },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: tutor.id,
        email: "planning-tutor@example.test",
        tutorId: tutor.tutorId,
        role: "TUTOR",
        emailVerifiedAt: now,
      },
      {
        id: one.id,
        email: "planning-one@example.test",
        studentId: "planning-one",
        tuteeMember: true,
        emailVerifiedAt: now,
      },
      {
        id: two.id,
        email: "planning-two@example.test",
        studentId: "planning-two",
        tuteeMember: true,
        emailVerifiedAt: now,
      },
    ],
  });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Synthetic tutoring rules",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: tutor.id,
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic Tutor",
    },
  });
  await db.pairing.create({
    data: {
      id: "planning-pairing",
      tutorId: tutor.tutorId,
      termId: "planning-term",
      subject: "Math",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 945,
      scheduleConfirmed: true,
      roomMode: "NONE",
      tutees: {
        create: [{ tuteeId: "planning-one" }, { tuteeId: "planning-two" }],
      },
    },
  });
  await ensureSessionPlanningWindow(db, now);
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await db.$disconnect();
});

describe("durable individual agreement", () => {
  it("serializes a committed departure before concurrent consent and refuses the stale actor", async () => {
    const { id } = await propose();
    const ready = signal(),
      release = signal(),
      attempted = signal();
    let observeAcceptance = false;
    const original = transactionHelpers.lockEntity;
    const spy = vi
      .spyOn(transactionHelpers, "lockEntity")
      .mockImplementation(async (tx, key) => {
        if (observeAcceptance && key === "program:period") {
          observeAcceptance = false;
          attempted.resolve();
        }
        await original(tx, key);
      });
    try {
      const departure = db.$transaction(async (tx) => {
        await changeSchoolDeparture(
          tx,
          {
            userId: one.id,
            action: "TRANSFERRED",
            expectedRevision: 0,
            explanation: "Synthetic race fixture",
          },
          tutor.id,
        );
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      observeAcceptance = true;
      const acceptance = respond(id, one, "ACCEPT").then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error }),
      );
      await attempted.promise;
      release.resolve();
      await departure;
      expect(await acceptance).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      await sweepSessionPlanning(db, now);
      expect((await read(id)).status).toBe("STALE");
      expect(
        await db.sessionPlanCohort.count({ where: { rescheduled: true } }),
      ).toBe(0);
      expect(await db.session.count()).toBe(0);
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  });

  it("reports a missed eligible deadline after downtime without retroactively moving attendance", async () => {
    const { id } = await propose();
    const { request, offer } = await current(id);
    const response = offer.responses.find(
      (row) => row.actorKey === "tutee:planning-one",
    )!;
    await db.$transaction((tx) =>
      markSessionResponseDelivered(tx, response.id, now),
    );
    const resumed = new Date("2026-11-02T07:01:00Z");
    await sweepSessionPlanning(db, resumed);
    expect((await read(id)).status).toBe("EXPIRED");
    expect(
      (
        await db.sessionPlanParticipant.findUniqueOrThrow({
          where: {
            planId_tuteeId: { planId: request.planId, tuteeId: "planning-one" },
          },
        })
      ).cohortId,
    ).toBe(request.cohortId);
    const notice = await db.sessionNotice.findFirstOrThrow({
      where: {
        requestId: id,
        recipientUserId: one.id,
        event: "deadline_missed",
      },
    });
    expect(notice.context).toMatchObject({
      outcomeReason: "MISSED_AUTOMATIC_RESPONSE_WINDOW",
      isActionable: false,
    });
    const agenda = await readSessionAgenda(db, one, "tutee", resumed);
    expect(agenda.notices.find((row) => row.id === notice.id)).toMatchObject({
      actionRequired: true,
      context: { outcomeReason: "MISSED_AUTOMATIC_RESPONSE_WINDOW" },
    });
    expect(await db.session.count()).toBe(0);
  });

  it("never reuses an ordinary moved cohort as a new extra lesson", async () => {
    const { id } = await propose();
    await respond(id, one, "ACCEPT");
    const sourceCohort = await source();
    await expect(
      proposeSession(db, tutor, {
        cohortId: sourceCohort.id,
        expectedVersion: sourceCohort.version,
        clientKey: randomUUID(),
        scope: "ONE",
        kind: "EXTRA",
        tuteeId: "planning-two",
        ...time(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.sessionPlan.count({ where: { kind: "EXTRA" } })).toBe(0);
  });
  it("rejects teaching while the same verified account is committed as another lesson's tutee", async () => {
    await db.tutee.create({
      data: {
        id: "planning-tutor-student",
        englishName: "Synthetic dual participant",
        status: "ACTIVE",
      },
    });
    await db.user.update({
      where: { id: tutor.id },
      data: { studentId: "planning-tutor-student", tuteeMember: true },
    });
    await db.tutor.create({
      data: {
        id: "planning-other-tutor",
        englishName: "Synthetic other tutor",
        status: "ACTIVE",
      },
    });
    await db.pairing.create({
      data: {
        id: "planning-cross-role",
        tutorId: "planning-other-tutor",
        termId: "planning-term",
        subject: "Science",
        dayOfWeek: 2,
        startMin: 900,
        endMin: 945,
        scheduleConfirmed: true,
        roomMode: "NONE",
        tutees: { create: { tuteeId: "planning-tutor-student" } },
      },
    });
    await expect(propose()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.sessionPlanningRequest.count()).toBe(0);
  });
  it("bounds A/B/C and cancels only one dated commitment without attendance or cards", async () => {
    const { id } = await propose();
    await respond(id, one, "REJECT", time("2026-11-04"));
    expect((await read(id)).stage).toBe(2);
    await respond(id, tutor, "REJECT", time("2026-11-05"));
    const { request, offer } = await current(id);
    const final = {
      requestId: id,
      offerId: offer.id,
      expectedVersion: request.version,
      clientKey: randomUUID(),
      decision: "REJECT" as const,
    };
    await respondSession(db, one, final);
    await respondSession(db, one, final); // exact accepted cancellation receipt survives retry
    expect((await read(id)).status).toBe("CANCELLED");
    const participants = await db.sessionPlanParticipant.findMany({
      where: { planId: request.planId },
    });
    expect(
      participants.find((person) => person.tuteeId === "planning-one")?.status,
    ).toBe("CANCELLED");
    expect(
      participants.find((person) => person.tuteeId === "planning-two")?.status,
    ).toBe("SCHEDULED");
    expect(await db.session.count()).toBe(0);
    expect(await db.disciplinaryCard.count()).toBe(0);
    expect(await db.pairingTutee.count()).toBe(2);
  });

  it("starts silence consent only after successful essential transport acceptance", async () => {
    const { id } = await propose();
    await sweepSessionPlanning(db, new Date("2026-10-27T01:00:00Z"));
    expect((await read(id)).status).toBe("PENDING");
    const { offer } = await current(id);
    const response = offer.responses.find(
      (row) => row.actorKey === "tutee:planning-one",
    )!;
    const delivered = new Date("2026-10-27T02:00:00Z");
    await db.$transaction((tx) =>
      markSessionResponseDelivered(tx, response.id, delivered),
    );
    await db.$transaction((tx) =>
      markSessionResponseDelivered(
        tx,
        response.id,
        new Date("2026-10-27T03:00:00Z"),
      ),
    );
    const saved = await db.sessionPlanningResponse.findUniqueOrThrow({
      where: { id: response.id },
    });
    expect(saved.deadline?.toISOString()).toBe("2026-10-28T02:00:00.000Z");
    await sweepSessionPlanning(db, new Date("2026-10-28T02:00:00Z"));
    expect((await read(id)).status).toBe("ACCEPTED");
    expect(
      (
        await db.sessionPlanningResponse.findUniqueOrThrow({
          where: { id: response.id },
        })
      ).acceptedBy,
    ).toBe("TIMEOUT");
    expect(await db.session.count()).toBe(0);
  });

  it("supports the tutor's B-stage timeout with the tutee's offered agreement retained", async () => {
    const { id } = await propose();
    await respond(id, one, "REJECT", time("2026-11-04"));
    const { offer } = await current(id);
    const response = offer.responses.find(
      (row) => row.actorKey === `tutor:${tutor.tutorId}`,
    )!;
    await db.$transaction((tx) =>
      markSessionResponseDelivered(tx, response.id, now),
    );
    await sweepSessionPlanning(db, new Date(now.getTime() + 86_400_000));
    expect((await read(id)).status).toBe("ACCEPTED");
  });

  it("does not autoaccept a tutor response after live authority changes to Viewer", async () => {
    const { id } = await propose();
    await respond(id, one, "REJECT", time("2026-11-04"));
    const { offer } = await current(id);
    const response = offer.responses.find(
      (row) => row.actorKey === `tutor:${tutor.tutorId}`,
    )!;
    await db.$transaction((tx) =>
      markSessionResponseDelivered(tx, response.id, now),
    );
    await db.user.update({
      where: { id: tutor.id },
      data: { role: "VIEWER", tutorAccessRevoked: true },
    });
    await sweepSessionPlanning(db, new Date(now.getTime() + 86_400_000));
    expect((await read(id)).status).toBe("STALE");
    expect(
      await db.sessionPlanCohort.count({ where: { rescheduled: true } }),
    ).toBe(0);
    expect(await db.session.count()).toBe(0);
  });

  it("expires short notice at the earlier start without shortening the 24h silence period", async () => {
    const cohort = await source();
    const { id } = await proposeSession(db, tutor, {
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "planning-one",
      date: "2026-10-26",
      startMin: 1020,
      online: false,
    });
    const { request, offer } = await current(id);
    const response = offer.responses.find(
      (row) => row.actorKey === "tutee:planning-one",
    )!;
    await db.$transaction((tx) =>
      markSessionResponseDelivered(tx, response.id, now),
    );
    expect(
      (
        await db.sessionPlanningResponse.findUniqueOrThrow({
          where: { id: response.id },
        })
      ).deadline,
    ).toBeNull();
    await sweepSessionPlanning(db, offer.startsAt);
    expect((await read(id)).status).toBe("EXPIRED");
    expect(
      (
        await db.sessionPlanParticipant.findUniqueOrThrow({
          where: {
            planId_tuteeId: { planId: request.planId, tuteeId: "planning-one" },
          },
        })
      ).cohortId,
    ).toBe(request.cohortId);
  });

  it("binds immediate formalization to exact current structured suggestion evidence", async () => {
    const cohort = await source();
    const suggestion = await suggestSessionTime(db, one, {
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      clientKey: randomUUID(),
      ...time(),
    });
    await expect(
      proposeSession(db, tutor, {
        cohortId: cohort.id,
        expectedVersion: cohort.version,
        clientKey: randomUUID(),
        scope: "ONE",
        kind: "RESCHEDULE",
        tuteeId: "planning-one",
        suggestionId: suggestion.id,
        ...time("2026-11-04"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const result = await proposeSession(db, tutor, {
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "planning-one",
      suggestionId: suggestion.id,
      ...time(),
    });
    expect((await read(result.id)).status).toBe("ACCEPTED");
    expect(
      (await current(result.id)).offer.responses.find(
        (row) => row.actorKey === "tutee:planning-one",
      )?.acceptedBy,
    ).toBe("MATCHED");
  });

  it("rejects a forged owner and keeps an extra's final rejection separate from ordinary recurrence", async () => {
    const { id } = await propose("ONE", "EXTRA");
    await expect(respond(id, two, "ACCEPT")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await respond(id, one, "REJECT", time("2026-11-04"));
    await respond(id, tutor, "REJECT", time("2026-11-05"));
    await respond(id, one, "REJECT");
    expect(
      await db.sessionPlanParticipant.count({ where: { status: "CANCELLED" } }),
    ).toBe(0);
    expect(await db.sessionPlan.count({ where: { kind: "EXTRA" } })).toBe(0);
  });
});

describe("whole-group agreement and split", () => {
  it("gives split-extra children one explicit extra root and physical cohort with replay-safe membership", async () => {
    const { id } = await propose("ALL", "EXTRA");
    await respond(id, one, "REJECT", time("2026-11-04"));
    await respond(id, two, "REJECT", time("2026-11-05"));
    const parent = await read(id);
    await requestSeparateSession(db, one, {
      requestId: id,
      expectedVersion: parent.version,
      clientKey: randomUUID(),
    });
    const split = await read(id);
    await formalizeSeparateSessions(db, tutor, {
      requestId: id,
      expectedVersion: split.version,
      clientKey: randomUUID(),
    });
    const children = await db.sessionPlanningRequest.findMany({
      where: { parentRequestId: id },
    });
    const first = children.find(
      (row) =>
        JSON.stringify(row.participantIds) === JSON.stringify(["planning-one"]),
    )!;
    const second = children.find((row) => row.id !== first.id)!;
    await respond(first.id, one, "ACCEPT");
    const target = await db.sessionPlanCohort.findFirstOrThrow({
      where: { plan: { generationKey: `extra:${id}` } },
    });
    const room = await db.room.create({
      data: { name: "Synthetic conflicting extra location" },
    });
    await expect(
      respond(second.id, two, "REJECT", {
        ...time("2026-11-05"),
        roomId: room.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      respond(second.id, two, "REJECT", {
        ...time("2026-11-05"),
        startMin: 930,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const latest = await current(second.id);
    const accept = {
      requestId: second.id,
      offerId: latest.offer.id,
      expectedVersion: latest.request.version,
      clientKey: randomUUID(),
      decision: "ACCEPT" as const,
    };
    await respondSession(db, two, accept);
    await respondSession(db, two, accept);
    expect(
      await db.sessionPlan.count({ where: { generationKey: `extra:${id}` } }),
    ).toBe(1);
    expect(
      await db.sessionPlanCohort.count({ where: { planId: target.planId } }),
    ).toBe(1);
    expect(
      await db.sessionPlanParticipant.count({
        where: { cohortId: target.id, status: "SCHEDULED" },
      }),
    ).toBe(2);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: target.id },
        })
      ).version,
    ).toBe(2);
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        target.id,
        undefined,
        new Date("2026-11-06T12:00:00Z"),
      ),
    );
    expect(context.tuteeIds.sort()).toEqual(["planning-one", "planning-two"]);
    expect(context.kind).toBe("EXTRA");
    expect(context.pairingIds).toEqual(["planning-pairing"]);
  });
  it("serializes concurrent acceptance and counteroffer against one captured version", async () => {
    const { id } = await propose("ALL");
    const { request, offer } = await current(id);
    const results = await Promise.allSettled([
      respondSession(db, one, {
        requestId: id,
        offerId: offer.id,
        expectedVersion: request.version,
        clientKey: randomUUID(),
        decision: "ACCEPT",
      }),
      respondSession(db, two, {
        requestId: id,
        offerId: offer.id,
        expectedVersion: request.version,
        clientKey: randomUUID(),
        decision: "REJECT",
        alternative: time("2026-11-04"),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const after = await read(id);
    expect(after.status).toBe("PENDING");
    expect(
      await db.sessionPlanCohort.count({
        where: { planId: request.planId, rescheduled: true },
      }),
    ).toBe(0);
  });
  it("requires unanimous responses to one current version and invalidates obsolete acceptance", async () => {
    const { id } = await propose("ALL");
    const original = await current(id);
    await respond(id, one, "ACCEPT");
    expect((await read(id)).status).toBe("PENDING");
    await respond(id, two, "REJECT", time("2026-11-04"));
    const next = await current(id);
    expect(
      next.offer.responses.find((row) => row.actorKey === "tutee:planning-one")
        ?.state,
    ).toBe("PENDING");
    await expect(
      respondSession(db, one, {
        requestId: id,
        offerId: original.offer.id,
        expectedVersion: original.request.version,
        decision: "ACCEPT",
        clientKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await respond(id, one, "ACCEPT");
    await respond(id, tutor, "ACCEPT");
    expect((await read(id)).status).toBe("ACCEPTED");
    const commitments = await db.sessionPlanParticipant.findMany({
      where: { planId: next.request.planId },
    });
    expect(new Set(commitments.map((person) => person.cohortId)).size).toBe(1);
    expect(commitments.every((person) => person.version === 2)).toBe(true);
  });

  it("preserves one-reject budgets and stops all parent timers immediately on split request", async () => {
    const { id } = await propose("ALL");
    await respond(id, one, "REJECT", time("2026-11-04"));
    await respond(id, two, "REJECT", time("2026-11-05"));
    await expect(
      respond(id, one, "REJECT", time("2026-11-06")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const parent = await read(id);
    await requestSeparateSession(db, one, {
      requestId: id,
      expectedVersion: parent.version,
      clientKey: randomUUID(),
    });
    await sweepSessionPlanning(db, new Date("2026-10-30T00:00:00Z"));
    expect((await read(id)).status).toBe("SPLIT_REQUESTED");
    const state = await read(id);
    await formalizeSeparateSessions(db, tutor, {
      requestId: id,
      expectedVersion: state.version,
      clientKey: randomUUID(),
    });
    expect((await read(id)).status).toBe("SPLIT");
    expect(
      await db.sessionPlanningRequest.count({
        where: { parentRequestId: id, scope: "ONE", status: "PENDING" },
      }),
    ).toBe(2);
    expect(await db.pairingTutee.count()).toBe(2);
  });
});

describe("publication and scoped attendance", () => {
  it("atomically suppresses a pre-start closure even when no agenda is read until after start", async () => {
    const original = await source();
    vi.setSystemTime(new Date(original.startsAt.getTime() - 60_000));
    await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic pre-start closure",
        expectedVersion: 0,
      },
      tutor.id,
    );
    const saved = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(saved.status).toBe("CANCELLED");
    expect(
      await db.sessionPlanParticipant.count({
        where: {
          cohortId: original.id,
          status: "CANCELLED",
          calendarSuppressed: true,
        },
      }),
    ).toBe(2);
    vi.setSystemTime(new Date(original.startsAt.getTime() + 10 * 60_000));
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.cohorts.find((row) => row.id === original.id)).toMatchObject({
      status: "CANCELLED",
      needsAttendance: false,
      canRecordAttendance: false,
    });
    await expect(
      db.$transaction((tx) =>
        sessionAttendanceContext(
          tx,
          tutor,
          original.id,
          undefined,
          new Date(original.endsAt.getTime() + 60_000),
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.session.count()).toBe(0);
    expect(await db.disciplinaryCard.count()).toBe(0);
  });

  it("preserves already-started published evidence when a calendar edit is retrospective", async () => {
    const original = await source();
    vi.setSystemTime(new Date(original.startsAt.getTime() + 10 * 60_000));
    await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic retrospective note",
        expectedVersion: 0,
      },
      tutor.id,
    );
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("SCHEDULED");
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        original.id,
        undefined,
        new Date(original.endsAt.getTime() + 60_000),
      ),
    );
    expect(context.tuteeIds.sort()).toEqual(["planning-one", "planning-two"]);
    expect(await db.session.count()).toBe(0);
  });

  it("retains only an explicitly returned learner through closure and reset of a shared ordinary cohort", async () => {
    const { original, participantId } = await returnOneToOrdinaryCohort();
    const before = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: participantId },
    });
    const peerBefore = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: { planId: original.planId, tuteeId: "planning-two" },
      },
    });
    expect(before.cohortId).toBe(original.id);
    expect(before.scheduleOverride).toBe(true);
    expect(peerBefore.scheduleOverride).toBe(false);
    const closed = await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic shared cohort closure",
        expectedVersion: 0,
      },
      tutor.id,
    );
    const kept = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: before.id },
    });
    const suppressed = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: peerBefore.id },
    });
    expect(kept).toEqual(before);
    expect(suppressed).toMatchObject({
      cohortId: original.id,
      status: "CANCELLED",
      calendarSuppressed: true,
      scheduleOverride: false,
    });
    expect(suppressed.version).toBe(peerBefore.version + 1);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("SCHEDULED");
    const ownAgenda = await readSessionAgenda(db, one, "tutee"),
      peerAgenda = await readSessionAgenda(db, two, "tutee");
    expect(
      ownAgenda.cohorts.find((row) => row.id === original.id),
    ).toMatchObject({ status: "SCHEDULED", rescheduled: true });
    expect(
      peerAgenda.cohorts.find((row) => row.id === original.id),
    ).toMatchObject({ status: "CANCELLED", rescheduled: false });
    await resetSchoolCalendar(
      db,
      { date: original.date, expectedVersion: closed.version },
      tutor.id,
    );
    const restored = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: peerBefore.id },
    });
    expect(restored).toMatchObject({
      cohortId: original.id,
      status: "SCHEDULED",
      calendarSuppressed: false,
      scheduleOverride: false,
    });
    expect(restored.version).toBe(suppressed.version + 1);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: before.id },
      }),
    ).toEqual(before);
    const reset = await db.schoolCalendarDay.findUniqueOrThrow({
      where: { date: original.date },
    });
    await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic second closure",
        expectedVersion: reset.version,
      },
      tutor.id,
    );
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        original.id,
        undefined,
        new Date(original.endsAt.getTime() + 60_000),
      ),
    );
    expect(context.tuteeIds).toEqual(["planning-one"]);
    expect(context.rescheduled).toBe(true);
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(1);
    expect(await db.session.count()).toBe(0);
  });

  it("moves ordinary peers with a changed weekly clock while preserving a returned learner's exact agreement", async () => {
    const { original, participantId } = await returnOneToOrdinaryCohort();
    const kept = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: participantId },
    });
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 960, endMin: 1005 },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toEqual(kept);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).startMin,
    ).toBe(900);
    const peer = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: { planId: original.planId, tuteeId: "planning-two" },
      },
      include: { cohort: true },
    });
    expect(peer.cohortId).not.toBe(original.id);
    expect(peer.cohort?.startMin).toBe(960);
    expect(peer.scheduleOverride).toBe(false);
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(2);
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 900, endMin: 945 },
    });
    await ensureSessionPlanningWindow(db, now);
    const rejoined = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: peer.id },
    });
    expect(rejoined.cohortId).toBe(original.id);
    expect(rejoined.version).toBe(peer.version + 1);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toEqual(kept);
    const retired = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: peer.cohortId! },
    });
    expect(retired.status).toBe("CANCELLED");
    expect(retired.version).toBe(peer.cohort!.version + 1);
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(1);
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        original.id,
        undefined,
        new Date(original.endsAt.getTime() + 60_000),
      ),
    );
    expect(context.tuteeIds.sort()).toEqual(["planning-one", "planning-two"]);
    // Coalescing is exact: an overlapping different clock must remain unavailable.
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 915, endMin: 960 },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: peer.id },
      }),
    ).toMatchObject({
      cohortId: original.id,
      status: "CANCELLED",
      calendarSuppressed: true,
    });
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toEqual(kept);
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 900, endMin: 945 },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: peer.id },
      }),
    ).toMatchObject({
      cohortId: original.id,
      status: "SCHEDULED",
      calendarSuppressed: false,
    });
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(1);
  });
  it("repairs a future legacy calendar tombstone only for its accepted learner agreement", async () => {
    const room = await db.room.create({
      data: { name: "Synthetic restoration room" },
    });
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { roomId: room.id, roomMode: "FIXED" },
    });
    await ensureSessionPlanningWindow(db, now);
    const { original, participantId } = await returnOneToOrdinaryCohort();
    await db.sessionPlanParticipant.update({
      where: { id: participantId },
      data: { calendarSuppressed: true },
    });
    await db.sessionPlanParticipant.updateMany({
      where: { planId: original.planId, tuteeId: "planning-two" },
      data: { status: "CANCELLED", calendarSuppressed: false },
    });
    await db.sessionPlanCohort.update({
      where: { id: original.id },
      data: { status: "CANCELLED", sourceInvalidated: true },
    });
    await db.schoolCalendarDay.create({
      data: { date: original.date, isSchoolDay: false, timetableWeekday: null },
    });
    const before = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: { id: participantId },
    });
    // The ordinary room was released while the lesson was tombstoned. The
    // learner's exact prior agreement still retains that room independently.
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { roomId: null, roomMode: "NONE" },
    });
    const blackout = await db.roomUnavailability.create({
      data: {
        roomId: room.id,
        dayOfWeek: 1,
        startMin: original.startMin,
        endMin: original.endMin,
      },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toEqual(before);
    expect(
      await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toMatchObject({ status: "CANCELLED", sourceInvalidated: true });
    await expect(
      db.$transaction((tx) =>
        sessionAttendanceContext(
          tx,
          tutor,
          original.id,
          undefined,
          new Date(original.endsAt.getTime() + 60_000),
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db.roomUnavailability.delete({ where: { id: blackout.id } });
    const sibling = await db.sessionPlanCohort.create({
      data: {
        planId: original.planId,
        date: original.date,
        startMin: original.startMin,
        endMin: original.endMin,
        startsAt: original.startsAt,
        endsAt: original.endsAt,
        roomId: original.roomId,
        online: original.online,
        rescheduled: true,
      },
    });
    await db.sessionPlanParticipant.updateMany({
      where: { planId: original.planId, tuteeId: "planning-two" },
      data: {
        cohortId: sibling.id,
        status: "SCHEDULED",
        scheduleOverride: true,
      },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toMatchObject({ status: "CANCELLED", sourceInvalidated: true });
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toEqual(before);
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(1);
    await db.sessionPlanCohort.update({
      where: { id: sibling.id },
      data: { status: "CANCELLED" },
    });
    await db.sessionPlanParticipant.updateMany({
      where: { planId: original.planId, tuteeId: "planning-two" },
      data: { status: "CANCELLED" },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: participantId },
      }),
    ).toMatchObject({
      cohortId: original.id,
      status: "SCHEDULED",
      scheduleOverride: true,
      calendarSuppressed: false,
      version: before.version + 1,
    });
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: {
          planId_tuteeId: { planId: original.planId, tuteeId: "planning-two" },
        },
      }),
    ).toMatchObject({ status: "CANCELLED", calendarSuppressed: false });
    expect(
      await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toMatchObject({ status: "SCHEDULED", sourceInvalidated: false });
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        original.id,
        undefined,
        new Date(original.endsAt.getTime() + 60_000),
      ),
    );
    expect(context.tuteeIds).toEqual(["planning-one"]);
  });
  it("requires inactivation rather than deletion once a tutee has published planning evidence", async () => {
    expect(await db.session.count()).toBe(0);
    await expect(
      assertNoPublishedTuteeDeletion(db, "planning-one"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      assertNoPublishedTuteeDeletion(db, "planning-one"),
    ).rejects.toThrow(/Set them inactive/);
    expect(
      await db.sessionPlanParticipant.count({
        where: { tuteeId: "planning-one" },
      }),
    ).toBeGreaterThan(0);
    expect(
      await db.pairingTutee.count({ where: { tuteeId: "planning-one" } }),
    ).toBe(1);
  });
  it("maps a real Saturday to Monday and resets it without replacing dated identities", async () => {
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-10-31" } }),
    ).toBe(0);
    const override = await saveSchoolCalendar(
      db,
      {
        date: "2026-10-31",
        isSchoolDay: true,
        timetableWeekday: 1,
        note: "Synthetic makeup school day",
        expectedVersion: 0,
      },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    const mapped = await db.sessionPlanCohort.findFirstOrThrow({
      where: { date: "2026-10-31" },
    });
    expect(mapped.status).toBe("SCHEDULED");
    await resetSchoolCalendar(
      db,
      { date: "2026-10-31", expectedVersion: override.version },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    const cancelled = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: mapped.id },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.sourceInvalidated).toBe(true);
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-10-31" } }),
    ).toBe(1);
  });

  it("keeps note-only calendar edits from replacing offer, response or cohort versions", async () => {
    const first = await saveSchoolCalendar(
      db,
      {
        date: "2026-11-02",
        isSchoolDay: true,
        timetableWeekday: 1,
        note: "Synthetic first note",
        expectedVersion: 0,
      },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    const { id } = await propose();
    const before = await current(id),
      cohort = await source();
    const plan = await db.sessionPlan.findUniqueOrThrow({
      where: { id: cohort.planId },
    });
    const noticeCount = await db.sessionNotice.count();
    const edited = await saveSchoolCalendar(
      db,
      {
        date: first.date,
        isSchoolDay: true,
        timetableWeekday: 1,
        note: "Synthetic revised note",
        expectedVersion: first.version,
      },
      tutor.id,
    );
    expect(edited.scheduleRevision).toBe(first.scheduleRevision);
    await ensureSessionPlanningWindow(db, now);
    expect(await current(id)).toEqual(before);
    expect(
      await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: cohort.id },
      }),
    ).toEqual(cohort);
    expect(
      (await db.sessionPlan.findUniqueOrThrow({ where: { id: plan.id } }))
        .sourceScheduleFingerprint,
    ).toBe(plan.sourceScheduleFingerprint);
    expect(await db.sessionNotice.count()).toBe(noticeCount);
  });

  it("suppresses ordinary closure dates while retaining explicit extras and reschedules through reset", async () => {
    const original = await source();
    const { id } = await propose();
    await respond(id, one, "ACCEPT");
    const remaining = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: original.id },
    });
    const moved = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: { planId: original.planId, tuteeId: "planning-one" },
      },
    });
    const extra = await proposeSession(db, tutor, {
      cohortId: remaining.id,
      expectedVersion: remaining.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "EXTRA",
      tuteeId: "planning-two",
      ...time("2026-11-04"),
    });
    await respond(extra.id, two, "ACCEPT");
    const added = await db.sessionPlanCohort.findFirstOrThrow({
      where: { plan: { kind: "EXTRA" } },
    });
    const closed = await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic holiday",
        expectedVersion: 0,
      },
      tutor.id,
    );
    for (const date of ["2026-11-03", "2026-11-04"])
      await saveSchoolCalendar(
        db,
        {
          date,
          isSchoolDay: false,
          timetableWeekday: null,
          note: "Synthetic holiday",
          expectedVersion: 0,
        },
        tutor.id,
      );
    await ensureSessionPlanningWindow(db, now);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: moved.cohortId! },
        })
      ).status,
    ).toBe("SCHEDULED");
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: added.id },
        })
      ).status,
    ).toBe("SCHEDULED");
    await resetSchoolCalendar(
      db,
      { date: closed.date, expectedVersion: closed.version },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    expect(
      (
        await db.sessionPlanParticipant.findUniqueOrThrow({
          where: { id: moved.id },
        })
      ).cohortId,
    ).toBe(moved.cohortId);
    expect(
      await db.sessionPlanCohort.count({
        where: { planId: original.planId, date: original.date },
      }),
    ).toBe(1);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("SCHEDULED");
  });

  it("allows a pending unanimous alternate from a newly suppressed source without resurrecting the closed original", async () => {
    const original = await source();
    const { id } = await propose("ALL");
    await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic closure",
        expectedVersion: 0,
      },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("CANCELLED");
    await expect(
      db.$transaction((tx) =>
        sessionAttendanceContext(
          tx,
          tutor,
          original.id,
          undefined,
          new Date("2026-11-03T12:00:00Z"),
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await respond(id, one, "ACCEPT");
    await respond(id, two, "ACCEPT");
    const moved = await db.sessionPlanCohort.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(moved.status).toBe("SCHEDULED");
    expect(moved.rescheduled).toBe(true);
    expect(moved.sourceInvalidated).toBe(false);
    expect(moved.date).toBe("2026-11-03");
    expect(await db.session.count()).toBe(0);
    const override = await db.schoolCalendarDay.findUniqueOrThrow({
      where: { date: original.date },
    });
    await resetSchoolCalendar(
      db,
      { date: original.date, expectedVersion: override.version },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanCohort.count({
        where: {
          planId: original.planId,
          date: original.date,
          status: "SCHEDULED",
        },
      }),
    ).toBe(0);
  });

  it("expires a short-notice alternate while preserving calendar suppression of its original", async () => {
    const original = await source();
    const result = await proposeSession(db, tutor, {
      cohortId: original.id,
      expectedVersion: original.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "planning-one",
      date: "2026-10-26",
      startMin: 1020,
      online: false,
    });
    await saveSchoolCalendar(
      db,
      {
        date: original.date,
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic closure",
        expectedVersion: 0,
      },
      tutor.id,
    );
    await ensureSessionPlanningWindow(db, now);
    await sweepSessionPlanning(db, new Date("2026-10-26T09:00:00Z"));
    expect((await read(result.id)).status).toBe("EXPIRED");
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(await db.session.count()).toBe(0);
  });

  it("guards room-block creation and edits against an agreed holiday extra and pending offers", async () => {
    const room = await db.room.create({
      data: { name: "Synthetic planned room" },
    });
    const original = await source();
    await saveSchoolCalendar(
      db,
      {
        date: "2026-11-06",
        isSchoolDay: false,
        timetableWeekday: null,
        note: "Synthetic closure",
        expectedVersion: 0,
      },
      tutor.id,
    );
    const extra = await proposeSession(db, tutor, {
      cohortId: original.id,
      expectedVersion: original.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "EXTRA",
      tuteeId: "planning-one",
      date: "2026-11-06",
      startMin: 900,
      roomId: room.id,
      online: false,
    });
    const blackout = {
      roomId: room.id,
      dayOfWeek: 5,
      startMin: 900,
      endMin: 945,
    };
    await expect(
      db.$transaction((tx) => assertRoomBlackoutAvailable(tx, blackout)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await respond(extra.id, one, "ACCEPT");
    await expect(
      db.$transaction((tx) => assertRoomBlackoutAvailable(tx, blackout)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const block = await db.roomUnavailability.create({
      data: { roomId: room.id, dayOfWeek: 4, startMin: 900, endMin: 945 },
    });
    await expect(
      db.$transaction((tx) =>
        assertRoomBlackoutAvailable(tx, {
          ...blackout,
          excludeBlockId: block.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db.$transaction((tx) =>
        assertRoomBlackoutAvailable(tx, {
          ...blackout,
          startMin: 945,
          endMin: 990,
        }),
      ),
    ).resolves.toBeUndefined();
  });
  it("serializes concurrent Sunday publication without duplicate identities or notices", async () => {
    const sunday = new Date("2026-11-01T04:00:00Z");
    await Promise.all([
      ensureSessionPlanningWindow(db, sunday),
      ensureSessionPlanningWindow(db, sunday),
    ]);
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-11-09" } }),
    ).toBe(1);
    const before = await db.sessionNotice.count();
    await ensureSessionPlanningWindow(db, sunday);
    expect(await db.sessionNotice.count()).toBe(before);
  });

  it("keeps an ended published prior-term lesson recordable using its captured roster", async () => {
    const cohort = await source();
    await db.term.update({
      where: { id: "planning-term" },
      data: { active: false },
    });
    await db.tutee.update({
      where: { id: "planning-one" },
      data: { status: "INACTIVE" },
    });
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        cohort.id,
        cohort.version,
        new Date("2026-11-03T00:00:00Z"),
      ),
    );
    expect(context.tuteeIds.sort()).toEqual(["planning-one", "planning-two"]);
    expect(context.primaryPairingId).toBe("planning-pairing");
  });
  it("catches deleted assignments on publication and retains cancellation notices and captured subjects", async () => {
    const cohort = await source();
    await db.pairing.delete({ where: { id: "planning-pairing" } });
    await ensureSessionPlanningWindow(db, now);
    expect(
      (
        await db.sessionPlanCohort.findUniqueOrThrow({
          where: { id: cohort.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      await db.sessionPlanParticipant.count({
        where: { planId: cohort.planId, status: "CANCELLED" },
      }),
    ).toBe(2);
    expect(
      await db.sessionNotice.count({ where: { event: "cancelled" } }),
    ).toBeGreaterThan(0);
    expect(
      (
        await db.sessionPlanAssignment.findFirstOrThrow({
          where: { planId: cohort.planId },
        })
      ).subject,
    ).toBe("Math");
  });

  it("never fabricates ended appointments on initial publication", async () => {
    await db.$executeRawUnsafe('TRUNCATE "SessionPlan" CASCADE');
    await ensureSessionPlanningWindow(db, new Date("2026-10-28T00:00:00Z"));
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-10-26" } }),
    ).toBe(0);
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-11-02" } }),
    ).toBe(1);
  });

  it("does not let an ALL extra replace the source booking", async () => {
    const cohort = await source();
    await expect(
      proposeSession(db, tutor, {
        cohortId: cohort.id,
        expectedVersion: cohort.version,
        clientKey: randomUUID(),
        scope: "ALL",
        kind: "EXTRA",
        date: cohort.date,
        startMin: cohort.startMin,
        online: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.sessionPlanningRequest.count()).toBe(0);
  });

  it("updates future ordinary plans while preserving agreed dated exceptions and commitment identities", async () => {
    const { id } = await propose();
    await respond(id, one, "ACCEPT");
    const moved = await db.sessionPlanParticipant.findFirstOrThrow({
      where: { planId: (await read(id)).planId, tuteeId: "planning-one" },
      include: { cohort: true },
    });
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 960, endMin: 1005 },
    });
    await ensureSessionPlanningWindow(db, now);
    expect(
      await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { id: moved.id },
        include: { cohort: true },
      }),
    ).toEqual(moved);
    const remaining = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: { planId: moved.planId, tuteeId: "planning-two" },
      },
      include: { cohort: true },
    });
    expect(remaining.cohort?.startMin).toBe(960);
    expect(remaining.version).toBe(2);
  });

  it("leaves a generated default unavailable if it would collide with an agreed exception", async () => {
    const cohort = await source();
    const result = await proposeSession(db, tutor, {
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "planning-one",
      date: "2026-11-09",
      startMin: 960,
      online: false,
    });
    await respond(result.id, one, "ACCEPT");
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { startMin: 960, endMin: 1005 },
    });
    await ensureSessionPlanningWindow(db, new Date("2026-11-01T04:00:00Z"));
    const generated = await db.sessionPlanCohort.findFirstOrThrow({
      where: { plan: { originalDate: "2026-11-09" } },
    });
    expect(generated.status).toBe("CANCELLED");
    expect(generated.sourceInvalidated).toBe(true);
    expect(
      await db.sessionPlanCohort.count({
        where: { date: "2026-11-09", status: "SCHEDULED" },
      }),
    ).toBe(1);
  });

  it("prepares Sunday ahead idempotently without resetting accepted exceptions or IDs", async () => {
    const { id } = await propose();
    await respond(id, one, "ACCEPT");
    const before = await db.sessionPlanParticipant.findMany({
      orderBy: { id: "asc" },
    });
    await ensureSessionPlanningWindow(db, new Date("2026-11-01T04:00:00Z"));
    const after = await db.sessionPlanParticipant.findMany({
      orderBy: { id: "asc" },
    });
    await ensureSessionPlanningWindow(db, new Date("2026-11-01T04:00:00Z"));
    expect(
      await db.sessionPlanParticipant.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(after);
    for (const prior of before)
      expect(after.find((row) => row.id === prior.id)).toEqual(prior);
    expect(
      await db.sessionPlan.count({ where: { originalDate: "2026-11-09" } }),
    ).toBe(1);
  });

  it("returns the exact split roster and derives extra/reschedule provenance without creating evidence", async () => {
    const { id } = await propose();
    await respond(id, one, "ACCEPT");
    const request = await read(id);
    const moved = await db.sessionPlanParticipant.findUniqueOrThrow({
      where: {
        planId_tuteeId: { planId: request.planId, tuteeId: "planning-one" },
      },
    });
    const context = await db.$transaction((tx) =>
      sessionAttendanceContext(
        tx,
        tutor,
        moved.cohortId!,
        undefined,
        new Date("2026-11-03T12:00:00Z"),
      ),
    );
    expect(context.tuteeIds).toEqual(["planning-one"]);
    expect(context.assignments[0]?.tuteeIds).toEqual(["planning-one"]);
    expect(context.rescheduled).toBe(true);
    expect(context.kind).toBe("REGULAR");
    expect(await db.session.count()).toBe(0);
  });
});
