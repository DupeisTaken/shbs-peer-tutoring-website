import { createHash, randomUUID } from "node:crypto";
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
import { runAuditedMutation } from "~/server/audit/evidence";
import {
  saveSchoolCalendar,
  resetSchoolCalendar,
} from "~/server/program/school-calendar";
import { saveProgramCalendar, removeProgramCalendar } from "~/server/program/calendar";
import { assertRoomBlackoutAvailable } from "~/server/room-bookings";
import { changeSchoolDeparture } from "~/server/school-departure";
import * as transactionHelpers from "~/server/transactions";
import { plannedWindow, type PlanningTime } from "~/lib/session-planning";
import { assertNoPublishedTuteeDeletion } from "./deletion-guards";
import { sessionCalendarFeed } from "~/server/session-planning-calendar";
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
  readSessionAgendaHistory,
  previewSessionLocation,
  previewProgramCalendarImpact,
  readCurrentSessionReminderCohort,
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

describe("regular tutoring pauses and affirmative exceptions", () => {
  async function pause(date = "2026-11-02", endDate = date) {
    // Domain-clock fixtures exercise the real scheduler against PostgreSQL.
    // Production writers use the DB semantic clock; never backdate that clock.
    const saved = await db.programCalendarDay.upsert({ where: { date },
      create: { date, endDate, reason: "Synthetic pause", schedulingEffect: "PAUSE_REGULAR" },
      update: { endDate, active: true, schedulingEffect: "PAUSE_REGULAR", version: { increment: 1 } },
    });
    await db.programCalendarPolicyRevision.create({ data: { date, endDate, schedulingEffect: "PAUSE_REGULAR", active: true, version: saved.version, effectiveAt: new Date() } });
    await ensureSessionPlanningWindow(db, new Date());
    return saved;
  }
  async function remove(date: string) {
    const saved = await db.programCalendarDay.update({ where: { date }, data: { active: false, version: { increment: 1 } } });
    await db.programCalendarPolicyRevision.create({ data: { date, endDate: saved.endDate, schedulingEffect: saved.schedulingEffect, active: false, version: saved.version, effectiveAt: new Date() } });
    await ensureSessionPlanningWindow(db, new Date());
    return saved;
  }
  const members = (cohortId: string) => db.sessionPlanParticipant.findMany({ where: { cohortId }, orderBy: { tuteeId: "asc" } });
  async function feeds() {
    const tokens = { tutor: "T".repeat(43), one: "A".repeat(43), two: "B".repeat(43) };
    const actors = [[tutor.id, tokens.tutor], [one.id, tokens.one], [two.id, tokens.two]] as const;
    for (const [userId, token] of actors)
      await db.sessionCalendarToken.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex") } });
    return async () => ({
      tutor: await sessionCalendarFeed(db, tokens.tutor, new Date()),
      one: await sessionCalendarFeed(db, tokens.one, new Date()),
      two: await sessionCalendarFeed(db, tokens.two, new Date()),
    });
  }
  function calendarEvent(feed: string | null, uid: string) {
    const block = feed?.split("BEGIN:VEVENT\r\n").find((part) => part.includes(`UID:${uid}\r\n`));
    expect(block).toBeDefined();
    const line = (name: string) => block?.split("\r\n").find((value) => value.startsWith(`${name}:`))?.slice(name.length + 1);
    return { uid: line("UID"), sequence: Number(line("SEQUENCE")), status: line("STATUS"), startsAt: line("DTSTART") };
  }

  it.each(["tutoring pause", "school closure"] as const)(
    "coalesces an unchanged-clock restoration into the exact agreed sibling after %s",
    async (restriction) => {
      const room = await db.room.create({ data: { name: "Synthetic A101" } });
      await db.pairing.update({
        where: { id: "planning-pairing" },
        data: { roomId: room.id, roomMode: "FIXED" },
      });
      await ensureSessionPlanningWindow(db, now);
      const original = await source();
      const originalPeople = await members(original.id);
      const readFeeds = await feeds();
      const originalUid = `cohort-${original.id}@shbs-session`;
      const learnerUids = {
        one: `commitment-${originalPeople.find((person) => person.tuteeId === "planning-one")!.id}@shbs-session`,
        two: `commitment-${originalPeople.find((person) => person.tuteeId === "planning-two")!.id}@shbs-session`,
      };
      const published = await readFeeds();
      // A school-closed source supports finishing its existing negotiation. A
      // tutoring pause also permits starting an explicit exception from it.
      if (restriction === "tutoring pause")
        await pause(original.date, "2026-11-06");
      const pending = await proposeSession(db, tutor, {
        cohortId: original.id,
        expectedVersion: (await source()).version,
        clientKey: randomUUID(),
        scope: "ONE",
        kind: "RESCHEDULE",
        tuteeId: "planning-one",
        date: "2026-11-03",
        startMin: 950,
        online: true,
      });
      const closure = restriction === "school closure"
        ? await saveSchoolCalendar(db, {
          date: original.date, isSchoolDay: false, timetableWeekday: null,
          note: "Synthetic closure before counteroffer", expectedVersion: 0,
        }, tutor.id)
        : null;
      await respond(pending.id, one, "REJECT", {
        date: original.date, startMin: original.startMin,
        roomId: original.roomId, online: original.online,
      });
      await respond(pending.id, tutor, "ACCEPT");
      const agreement = await read(pending.id);
      expect(agreement.status).toBe("ACCEPTED");
      const agreed = await db.sessionPlanParticipant.findUniqueOrThrow({
        where: { planId_tuteeId: { planId: original.planId, tuteeId: "planning-one" } },
      });
      const sibling = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: agreed.cohortId! } });
      expect(sibling.id).not.toBe(original.id);
      expect(sibling).toMatchObject({
        planId: original.planId, date: original.date,
        startMin: original.startMin, endMin: original.endMin,
        roomId: room.id, online: false, status: "SCHEDULED",
      });
      expect(agreed.scheduleOverride).toBe(true);
      const suppressedSource = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
      expect(suppressedSource.status).toBe("CANCELLED");
      const beforeReset = await readFeeds();
      if (closure)
        await resetSchoolCalendar(db, { date: original.date, expectedVersion: closure.version }, tutor.id);
      else
        await remove(original.date);

      const active = await db.sessionPlanCohort.findMany({
        where: { planId: original.planId, date: original.date, status: "SCHEDULED" },
      });
      expect(active.map((row) => row.id)).toEqual([sibling.id]);
      expect(active[0]?.version).toBe(sibling.version + 1);
      const restored = await members(sibling.id);
      expect(restored.map((person) => person.id).sort()).toEqual(originalPeople.map((person) => person.id).sort());
      expect(restored.map((person) => person.tuteeId)).toEqual(["planning-one", "planning-two"]);
      expect(restored.every((person) => person.status === "SCHEDULED" && !person.calendarSuppressed && !person.tutoringPauseSuppressed)).toBe(true);
      expect(restored.find((person) => person.tuteeId === "planning-one")).toEqual(agreed);
      expect(restored.find((person) => person.tuteeId === "planning-two")?.scheduleOverride).toBe(false);
      expect(await read(pending.id)).toEqual(agreement);
      const retired = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
      expect(retired).toMatchObject({ status: "CANCELLED", sourceInvalidated: false, version: suppressedSource.version + 1 });
      expect(await members(original.id)).toEqual([]);

      const resetFeeds = await readFeeds();
      const siblingUid = `cohort-${sibling.id}@shbs-session`;
      expect(calendarEvent(resetFeeds.tutor, siblingUid)).toMatchObject({ uid: siblingUid, status: "CONFIRMED", sequence: sibling.version + 1 });
      expect(calendarEvent(resetFeeds.tutor, originalUid)).toMatchObject({ uid: originalUid, status: "CANCELLED", sequence: retired.version });
      expect(calendarEvent(resetFeeds.tutor, originalUid).sequence).toBeGreaterThan(calendarEvent(beforeReset.tutor, originalUid).sequence);
      expect(calendarEvent(resetFeeds.one, learnerUids.one)).toEqual(calendarEvent(beforeReset.one, learnerUids.one));
      expect(calendarEvent(resetFeeds.two, learnerUids.two)).toMatchObject({ uid: learnerUids.two, status: "CONFIRMED", startsAt: calendarEvent(published.two, learnerUids.two).startsAt });
      expect(calendarEvent(resetFeeds.two, learnerUids.two).sequence).toBeGreaterThan(calendarEvent(beforeReset.two, learnerUids.two).sequence);
      const context = await db.$transaction((tx) => sessionAttendanceContext(
        tx, tutor, sibling.id, active[0]!.version, new Date(original.endsAt.getTime() + 1),
      ));
      expect(context.tuteeIds.sort()).toEqual(["planning-one", "planning-two"]);
      expect(context.assignments).toEqual([{ pairingId: "planning-pairing", subject: "Math", primary: true, tuteeIds: ["planning-one", "planning-two"] }]);
      expect(await db.session.count()).toBe(0);
      await ensureSessionPlanningWindow(db, now);
      await ensureSessionPlanningWindow(db, now);
      expect(await members(sibling.id)).toEqual(restored);
      expect(await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(active[0]);
      expect(await readFeeds()).toEqual(resetFeeds);

      await pause(original.date);
      const pausedAgain = await members(sibling.id);
      expect(pausedAgain.find((person) => person.tuteeId === "planning-one")).toEqual(agreed);
      expect(pausedAgain.find((person) => person.tuteeId === "planning-two")).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true, scheduleOverride: false });
      expect(await read(pending.id)).toEqual(agreement);
    },
  );

  it("preserves ordinary no-pause projection shapes and the baseline publication/reconciliation fingerprint", async () => {
    const original = await source();
    const ordinaryHash = (startMin: number) => createHash("sha256")
      .update(JSON.stringify([1, startMin, null, "Asia/Shanghai", []])).digest("hex");
    expect((await db.sessionPlan.findUniqueOrThrow({ where: { id: original.planId } })).sourceScheduleFingerprint).toBe(ordinaryHash(900));
    await db.pairing.update({ where: { id: "planning-pairing" }, data: { startMin: 915, endMin: 960 } });
    await ensureSessionPlanningWindow(db, now);
    expect((await db.sessionPlan.findUniqueOrThrow({ where: { id: original.planId } })).sourceScheduleFingerprint).toBe(ordinaryHash(915));
    const request = await propose();
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda).not.toHaveProperty("tutoringPauses");
    const cohort = agenda.cohorts.find((row) => row.id === original.id);
    expect(cohort).toBeDefined();
    for (const key of ["tutoringPaused", "canArrangeException", "pausedTutees"])
      expect(cohort).not.toHaveProperty(key);
    expect(agenda.requests.find((row) => row.id === request.id)?.currentOffer).not.toHaveProperty("requiresExplicitAcceptance");
  });

  it("keeps ended pause cancellations historical without claiming a current restoration error", async () => {
    const original = await source();
    await pause();
    const before = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id }, include: { participants: true } });
    const ended = new Date(original.endsAt.getTime() + 1);
    for (const [actor, role] of [[tutor, "tutor"], [one, "tutee"]] as const) {
      const history = await readSessionAgendaHistory(db, actor, { role }, ended);
      const recorded = history.cohorts.find((row) => row.id === original.id);
      expect(recorded).toMatchObject({ status: "CANCELLED", unavailable: false, canRecordAttendance: false });
      expect(recorded).not.toHaveProperty("canArrangeException");
    }
    expect(await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id }, include: { participants: true } })).toEqual(before);
    expect(await db.session.count()).toBe(0);
  });

  it("exports real private-feed cancellation and restoration with stable participant/cohort UIDs and increasing sequences", async () => {
    const original = await source();
    const people = await members(original.id);
    const oneId = people.find((person) => person.tuteeId === "planning-one")!.id;
    const twoId = people.find((person) => person.tuteeId === "planning-two")!.id;
    const readFeeds = await feeds();
    const before = await readFeeds();
    const keys = { tutor: `cohort-${original.id}@shbs-session`, one: `commitment-${oneId}@shbs-session`, two: `commitment-${twoId}@shbs-session` };
    await pause();
    await db.programCalendarDay.update({ where: { date: original.date }, data: { reason: "PRIVATE SYNTHETIC BREAK REASON" } });
    const cancelled = await readFeeds();
    await remove(original.date);
    const restored = await readFeeds();
    for (const kind of ["tutor", "one", "two"] as const) {
      const first = calendarEvent(before[kind], keys[kind]);
      const middle = calendarEvent(cancelled[kind], keys[kind]);
      const last = calendarEvent(restored[kind], keys[kind]);
      expect(first.status).toBe("CONFIRMED");
      expect(middle).toMatchObject({ uid: first.uid, startsAt: first.startsAt, status: "CANCELLED" });
      expect(middle.sequence).toBeGreaterThan(first.sequence);
      expect(last).toMatchObject({ uid: first.uid, startsAt: first.startsAt, status: "CONFIRMED" });
      expect(last.sequence).toBeGreaterThan(middle.sequence);
      expect(cancelled[kind]).not.toContain("PRIVATE SYNTHETIC BREAK REASON");
      expect(restored[kind]).not.toContain("ATTENDEE");
    }
    expect(before.one).not.toContain(keys.two);
    expect(before.two).not.toContain(keys.one);
    expect(before.tutor).not.toContain("commitment-");
    await ensureSessionPlanningWindow(db, now);
    await ensureSessionPlanningWindow(db, now);
    const repeated = await readFeeds();
    for (const kind of ["tutor", "one", "two"] as const)
      expect(calendarEvent(repeated[kind], keys[kind])).toEqual(calendarEvent(restored[kind], keys[kind]));
  });

  it("retains an explicitly agreed learner's feed identity, sequence and status while only the ordinary peer is paused", async () => {
    const { original } = await returnOneToOrdinaryCohort();
    const people = await members(original.id);
    const oneUid = `commitment-${people.find((person) => person.tuteeId === "planning-one")!.id}@shbs-session`;
    const twoUid = `commitment-${people.find((person) => person.tuteeId === "planning-two")!.id}@shbs-session`;
    const tutorUid = `cohort-${original.id}@shbs-session`;
    const readFeeds = await feeds();
    const before = await readFeeds();
    await pause();
    const paused = await readFeeds();
    expect(calendarEvent(paused.one, oneUid)).toEqual(calendarEvent(before.one, oneUid));
    expect(calendarEvent(paused.tutor, tutorUid).status).toBe("CONFIRMED");
    expect(calendarEvent(paused.two, twoUid).status).toBe("CANCELLED");
    expect(calendarEvent(paused.two, twoUid).sequence).toBeGreaterThan(calendarEvent(before.two, twoUid).sequence);
    expect(paused.one).not.toContain(twoUid);
    expect(paused.one).not.toContain("Synthetic Two");
    expect(paused.one).not.toContain("Synthetic pause");
    await remove(original.date);
    const restored = await readFeeds();
    expect(calendarEvent(restored.one, oneUid)).toEqual(calendarEvent(before.one, oneUid));
    expect(calendarEvent(restored.two, twoUid).status).toBe("CONFIRMED");
  });

  it("retains NOTICE semantics and pauses already-published ordinary commitments", async () => {
    const original = await source();
    await saveProgramCalendar(db, { date: original.date, endDate: original.date, reason: "Synthetic information", schedulingEffect: "NOTICE", expectedVersion: 0 });
    expect((await members(original.id)).every((person) => person.status === "SCHEDULED")).toBe(true);
    await pause();
    expect(await members(original.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "CANCELLED", tutoringPauseSuppressed: true, calendarSuppressed: false }),
    ]));
    const paused = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
    expect(paused).toMatchObject({ status: "CANCELLED", sourceInvalidated: false });
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.cohorts.find((row) => row.id === original.id)).toMatchObject({
      tutoringPaused: true, canArrangeException: true, canRecordAttendance: false,
      primaryPairingId: "planning-pairing", tutees: expect.arrayContaining([{ id: "planning-one", name: "Synthetic One" }]) as unknown,
    });
    expect(await db.session.count()).toBe(0);
  });

  it("applies and removes real-clock config pauses synchronously before any agenda read", async () => {
    vi.useRealTimers();
    await db.term.update({ where: { id: "planning-term" }, data: { startDate: null, endDate: null } });
    const realNow = new Date();
    await ensureSessionPlanningWindow(db, realNow);
    const future = await db.sessionPlanCohort.findFirstOrThrow({ where: { startsAt: { gt: realNow }, status: "SCHEDULED" }, orderBy: { startsAt: "asc" } });
    const saved = await saveProgramCalendar(db, { date: future.date, endDate: future.date, reason: "Synthetic real-clock policy", schedulingEffect: "PAUSE_REGULAR", expectedVersion: 0 });
    expect((await members(future.id)).every((person) => person.status === "CANCELLED" && person.tutoringPauseSuppressed)).toBe(true);
    await removeProgramCalendar(db, { date: saved.date, expectedVersion: saved.version });
    expect((await members(future.id)).every((person) => person.status === "SCHEDULED" && !person.tutoringPauseSuppressed)).toBe(true);
  });

  it("keeps repeated publication stable and overlapping pauses effective until both are removed", async () => {
    const original = await source();
    await pause("2026-11-01", "2026-11-03");
    await pause("2026-11-02", "2026-11-04");
    const before = await members(original.id);
    const cohortBefore = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
    await ensureSessionPlanningWindow(db, now);
    await ensureSessionPlanningWindow(db, now);
    expect(await members(original.id)).toEqual(before);
    expect(await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } })).toEqual(cohortBefore);
    await remove("2026-11-01");
    expect((await members(original.id)).every((row) => row.tutoringPauseSuppressed)).toBe(true);
    await remove("2026-11-02");
    expect((await members(original.id)).every((row) => row.status === "SCHEDULED" && !row.tutoringPauseSuppressed)).toBe(true);
  });

  it("publishes paused source tombstones when policy predates the publication window", async () => {
    await pause("2026-11-09", "2026-11-13");
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await ensureSessionPlanningWindow(db, new Date());
    const future = await db.sessionPlanCohort.findFirstOrThrow({ where: { date: "2026-11-09" } });
    expect(future.status).toBe("CANCELLED");
    expect((await members(future.id)).every((person) => person.tutoringPauseSuppressed)).toBe(true);
    const result = await proposeSession(db, tutor, { cohortId: future.id, expectedVersion: future.version, clientKey: randomUUID(), scope: "ONE", tuteeId: "planning-one", kind: "EXTRA", ...time("2026-11-10") });
    expect((await current(result.id)).request.status).toBe("PENDING");
  });

  it("retains both automatic reasons when a paused source is first published on a school closure", async () => {
    await pause("2026-11-09", "2026-11-13");
    await db.schoolCalendarDay.create({ data: { date: "2026-11-09", isSchoolDay: false, note: "Synthetic closure" } });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await ensureSessionPlanningWindow(db, new Date());
    const future = await db.sessionPlanCohort.findFirstOrThrow({ where: { date: "2026-11-09" } });
    expect((await members(future.id)).every((person) => person.status === "CANCELLED" && person.calendarSuppressed && person.tutoringPauseSuppressed)).toBe(true);
    // Sunday has prepared this source, but it enters the visible window Monday.
    vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.cohorts.find((row) => row.id === future.id)).toMatchObject({ tutoringPaused: true, canArrangeException: true, unavailable: false });
  });

  it("supports moving out from a paused source and an extra exception on the paused date", async () => {
    const original = await source();
    await pause();
    const moved = await propose("ONE", "RESCHEDULE", "2026-11-03");
    await respond(moved.id, one, "ACCEPT");
    const movedPerson = await db.sessionPlanParticipant.findUniqueOrThrow({ where: { planId_tuteeId: { planId: original.planId, tuteeId: "planning-one" } }, include: { cohort: true } });
    expect(movedPerson).toMatchObject({ status: "SCHEDULED", tutoringPauseSuppressed: false, cohort: { date: "2026-11-03" } });
    const pausedSource = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
    const extra = await proposeSession(db, tutor, { cohortId: original.id, expectedVersion: pausedSource.version, clientKey: randomUUID(), scope: "ONE", tuteeId: "planning-two", kind: "EXTRA", date: original.date, startMin: 960, online: true });
    await respond(extra.id, two, "ACCEPT");
    expect(await db.sessionPlanParticipant.count({ where: { plan: { kind: "EXTRA" }, status: "SCHEDULED" } })).toBe(1);
    expect((await members(original.id)).find((person) => person.tuteeId === "planning-two")).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true });
  });

  it("never accepts a paused target through delivered silence and issues no new autoaccept clock", async () => {
    await pause("2026-11-03");
    const proposed = await propose();
    const { offer } = await current(proposed.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, now));
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ deliveredAt: now, deadline: null, state: "PENDING" });
    vi.setSystemTime(new Date(now.getTime() + 2 * 86_400_000));
    await sweepSessionPlanning(db, new Date());
    expect((await current(proposed.id)).request.status).toBe("PENDING");
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.requests.find((row) => row.id === proposed.id)?.currentOffer).toMatchObject({ requiresExplicitAcceptance: true });
    await respond(proposed.id, one, "ACCEPT");
    expect((await current(proposed.id)).request.status).toBe("ACCEPTED");
  });

  it("clears an existing pending deadline during pause and never converts paused silence into acceptance after removal", async () => {
    const proposed = await propose();
    const { offer } = await current(proposed.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, now));
    expect((await current(proposed.id)).offer.responses.find((row) => row.id === response.id)?.deadline).not.toBeNull();
    await pause("2026-11-03");
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ state: "PENDING", deliveredAt: now, deadline: null });
    const corrected = await read(proposed.id);
    const notices = await db.sessionNotice.count({ where: { requestId: proposed.id } });
    await sweepSessionPlanning(db, now);
    await sweepSessionPlanning(db, now);
    expect((await read(proposed.id)).version).toBe(corrected.version);
    expect(await db.sessionNotice.count({ where: { requestId: proposed.id } })).toBe(notices);
    vi.setSystemTime(new Date(now.getTime() + 2 * 86_400_000));
    await remove("2026-11-03");
    await sweepSessionPlanning(db, new Date());
    expect((await current(proposed.id)).request.status).toBe("PENDING");
    expect(await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, new Date()))).toBe(false);
    expect((await current(proposed.id)).offer.responses.find((row) => row.id === response.id)?.deadline).toBeNull();
  });

  it("does not start an automatic clock after pause removal for an explicitly-only transport admission", async () => {
    await pause("2026-11-03");
    const proposed = await propose();
    const { offer } = await current(proposed.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await remove("2026-11-03");
    expect(await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, now, true))).toBe(true);
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ deliveredAt: now, deadline: null, state: "PENDING" });
    expect(await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, new Date(now.getTime() + 1000)))).toBe(false);
    vi.setSystemTime(new Date(now.getTime() + 2 * 86_400_000));
    await sweepSessionPlanning(db, new Date());
    expect((await current(proposed.id)).request.status).toBe("PENDING");
  });

  it("honors another admitted explicit receipt when an older normal completion arrives after removal", async () => {
    const proposed = await propose();
    const { offer } = await current(proposed.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await db.sessionNotice.create({ data: {
      dedupeKey: `synthetic-explicit-flight:${response.id}`, requestId: proposed.id, offerId: offer.id,
      responseId: response.id, recipientUserId: one.id, recipientEmail: "planning-one@example.test",
      event: "proposed", context: { isActionable: true, requiresExplicitAcceptance: true },
      status: "SENDING", attemptId: randomUUID(), attemptStartedAt: now,
    } });
    expect(await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, now, false))).toBe(true);
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ deliveredAt: now, deadline: null });
    // Model a previously stored normal timer from an older provider race. The
    // stricter completion clears it while preserving the original delivery time.
    await db.sessionPlanningResponse.update({ where: { id: response.id }, data: { deadline: new Date(now.getTime() + 86_400_000) } });
    expect(await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, new Date(now.getTime() + 1000), true))).toBe(false);
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ deliveredAt: now, deadline: null });
    await db.sessionPlanningResponse.update({ where: { id: response.id }, data: { deadline: new Date(now.getTime() + 86_400_000) } });
    vi.setSystemTime(new Date(now.getTime() + 2 * 86_400_000));
    await sweepSessionPlanning(db, new Date());
    expect((await current(proposed.id)).request.status).toBe("PENDING");
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ state: "PENDING", deadline: null });
  });

  it("preserves exact explicit agreements per learner while suppressing ordinary peers", async () => {
    const { original } = await returnOneToOrdinaryCohort();
    await pause();
    const people = await members(original.id);
    expect(people.find((person) => person.tuteeId === "planning-one")).toMatchObject({ status: "SCHEDULED", tutoringPauseSuppressed: false });
    expect(people.find((person) => person.tuteeId === "planning-two")).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true });
    const tutorAgenda = await readSessionAgenda(db, tutor, "tutor");
    expect(tutorAgenda.cohorts.find((row) => row.id === original.id)).toMatchObject({
      tutoringPaused: false, tutees: [{ id: "planning-one", name: "Synthetic One" }],
      pausedTutees: [{ id: "planning-two", name: "Synthetic Two" }], canArrangeException: true,
    });
    const activeAgenda = await readSessionAgenda(db, one, "tutee");
    const activeView = activeAgenda.cohorts.find((row) => row.id === original.id);
    for (const key of ["tutoringPaused", "canArrangeException", "pausedTutees"])
      expect(activeView).not.toHaveProperty(key);
    expect(await readCurrentSessionReminderCohort(db, original.id)).not.toBeNull();
  });

  it("does not treat an old timeout or scheduleOverride flag as explicit pause consent", async () => {
    const first = await propose();
    const { offer } = await current(first.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await db.$transaction((tx) => markSessionResponseDelivered(tx, response.id, now));
    vi.setSystemTime(new Date(now.getTime() + 86_400_000 + 1));
    await sweepSessionPlanning(db, new Date());
    expect((await current(first.id)).request.status).toBe("ACCEPTED");
    const person = await db.sessionPlanParticipant.findUniqueOrThrow({ where: { planId_tuteeId: { planId: (await source()).planId, tuteeId: "planning-one" } } });
    expect(person.scheduleOverride).toBe(true);
    await pause("2026-11-03");
    expect(await db.sessionPlanParticipant.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true });
  });

  it("does not promote split-parent timeout consent into a fresh MATCHED exception", async () => {
    const proposed = await propose("ALL");
    const { offer } = await current(proposed.id);
    // A captured split can contain previous timer evidence for one learner;
    // another group member still needs to respond to the shared offer.
    await db.sessionPlanningResponse.updateMany({ where: { offerId: offer.id, actorKey: "tutee:planning-one" }, data: { state: "ACCEPTED", acceptedBy: "TIMEOUT" } });
    const parent = await db.sessionPlanningRequest.update({ where: { id: proposed.id }, data: { status: "SPLIT_REQUESTED", version: { increment: 1 } } });
    await pause("2026-11-03");
    await formalizeSeparateSessions(db, tutor, { requestId: parent.id, expectedVersion: parent.version, clientKey: randomUUID() });
    const child = await db.sessionPlanningRequest.findFirstOrThrow({ where: { parentRequestId: parent.id, participantIds: { equals: ["planning-one"] } } });
    const childOffer = await current(child.id);
    expect(childOffer.request.status).toBe("PENDING");
    expect(childOffer.offer.responses.find((row) => row.actorKey === "tutee:planning-one")).toMatchObject({ state: "PENDING", acceptedBy: null });
    await respond(child.id, one, "ACCEPT");
    expect((await current(child.id)).request.status).toBe("ACCEPTED");
  });

  it("requires confirmation for historical MATCHED split children whose parent evidence was TIMEOUT", async () => {
    const original = await source();
    const proposed = await propose("ALL");
    const { offer } = await current(proposed.id);
    await db.sessionPlanningResponse.updateMany({ where: { offerId: offer.id, actorKey: "tutee:planning-one" }, data: { state: "ACCEPTED", acceptedBy: "TIMEOUT" } });
    const parent = await db.sessionPlanningRequest.update({ where: { id: proposed.id }, data: { status: "SPLIT_REQUESTED", version: { increment: 1 } } });
    await formalizeSeparateSessions(db, tutor, { requestId: parent.id, expectedVersion: parent.version, clientKey: randomUUID() });
    const child = await db.sessionPlanningRequest.findFirstOrThrow({ where: { parentRequestId: parent.id, participantIds: { equals: ["planning-one"] } } });
    const childOffer = await current(child.id);
    // Model the former writer's durable lossy provenance, without running it.
    await db.sessionPlanningResponse.updateMany({ where: { offerId: childOffer.offer.id, actorKey: "tutee:planning-one" }, data: { state: "ACCEPTED", acceptedBy: "MATCHED" } });
    await db.sessionPlanningRequest.update({ where: { id: child.id }, data: { status: "ACCEPTED" } });
    const moved = await db.sessionPlanCohort.create({ data: { planId: original.planId, ...plannedWindow(time(), "Asia/Shanghai"), rescheduled: true } });
    await db.sessionPlanParticipant.updateMany({ where: { planId: original.planId, tuteeId: "planning-one" }, data: { cohortId: moved.id, scheduleOverride: true } });
    await pause("2026-11-03");
    expect((await members(moved.id))[0]).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true });
  });

  it.each(["TIMEOUT", null])("requires confirmation for pending %s evidence while retaining delivery evidence", async (acceptedBy) => {
    const proposed = await propose("ALL");
    const { offer } = await current(proposed.id);
    const response = offer.responses.find((row) => row.actorKey === "tutee:planning-one")!;
    await db.sessionPlanningResponse.update({ where: { id: response.id }, data: { state: "ACCEPTED", acceptedBy, deliveredAt: now, deadline: new Date(now.getTime() + 86_400_000) } });
    await pause("2026-11-03");
    expect(await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({ state: "PENDING", acceptedBy: null, deliveredAt: now, deadline: null });
    await respond(proposed.id, one, "ACCEPT");
    await respond(proposed.id, two, "ACCEPT");
    expect((await current(proposed.id)).request.status).toBe("ACCEPTED");
  });

  it("does not resurrect user cancellations or school-closed sources on pause removal", async () => {
    const original = await source();
    await db.sessionPlanParticipant.updateMany({ where: { cohortId: original.id, tuteeId: "planning-one" }, data: { status: "CANCELLED", calendarSuppressed: false, tutoringPauseSuppressed: false } });
    await pause();
    await saveSchoolCalendar(db, { date: original.date, isSchoolDay: false, timetableWeekday: null, note: "Synthetic closure", expectedVersion: 0 }, tutor.id);
    await remove(original.date);
    const people = await members(original.id);
    expect(people.find((person) => person.tuteeId === "planning-one")).toMatchObject({ status: "CANCELLED", calendarSuppressed: false, tutoringPauseSuppressed: false });
    expect(people.find((person) => person.tuteeId === "planning-two")).toMatchObject({ status: "CANCELLED", calendarSuppressed: true, tutoringPauseSuppressed: false });
    const school = await db.schoolCalendarDay.findUniqueOrThrow({ where: { date: original.date } });
    await resetSchoolCalendar(db, { date: original.date, expectedVersion: school.version }, tutor.id);
    expect((await members(original.id)).find((person) => person.tuteeId === "planning-two")?.status).toBe("SCHEDULED");
  });

  it("reconciles future commitments beyond the current publication window and preserves started evidence", async () => {
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
    await ensureSessionPlanningWindow(db, new Date());
    const future = await db.sessionPlanCohort.findFirstOrThrow({ where: { date: "2026-11-23" } });
    vi.setSystemTime(now);
    await pause("2026-11-23");
    expect((await members(future.id)).every((person) => person.tutoringPauseSuppressed)).toBe(true);
    const original = await source();
    vi.setSystemTime(new Date(original.startsAt.getTime() + 1));
    await pause(original.date);
    expect((await members(original.id)).every((person) => person.status === "SCHEDULED")).toBe(true);
  });

  it.each(["closure-first", "pause-first"] as const)("retains independent pause exception entry for %s school-calendar transitions", async (order) => {
    const original = await source();
    if (order === "pause-first") await pause();
    await saveSchoolCalendar(db, { date: original.date, isSchoolDay: false, timetableWeekday: null, note: "Synthetic closure", expectedVersion: 0 }, tutor.id);
    if (order === "closure-first") await pause();
    const school = await db.schoolCalendarDay.findUniqueOrThrow({ where: { date: original.date } });
    await resetSchoolCalendar(db, { date: original.date, expectedVersion: school.version }, tutor.id);
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.cohorts.find((row) => row.id === original.id)).toMatchObject({ tutoringPaused: true, canArrangeException: true, unavailable: false, canRecordAttendance: false });
    const proposed = await propose("ONE", "RESCHEDULE", "2026-11-03");
    await respond(proposed.id, one, "ACCEPT");
    expect((await current(proposed.id)).request.status).toBe("ACCEPTED");
  });

  it("expires paused-target offers without restoring paused source commitments", async () => {
    await pause("2026-11-02", "2026-11-03");
    const proposed = await propose();
    const { offer } = await current(proposed.id);
    vi.setSystemTime(offer.cutoffAt);
    await sweepSessionPlanning(db, new Date());
    expect((await current(proposed.id)).request.status).toBe("EXPIRED");
    expect((await members((await source()).id)).every((person) => person.status === "CANCELLED" && person.tutoringPauseSuppressed)).toBe(true);
  });

  it("clears automatic pause reasons when the only paused source loses its assignment authority", async () => {
    const original = await source();
    await pause();
    await db.tutor.update({ where: { id: tutor.tutorId }, data: { status: "ARCHIVED" } });
    await ensureSessionPlanningWindow(db, now);
    expect((await members(original.id)).every((person) => person.status === "CANCELLED" && !person.tutoringPauseSuppressed)).toBe(true);
    await remove(original.date);
    expect((await members(original.id)).every((person) => person.status === "CANCELLED")).toBe(true);
  });

  it("does not revive an unconfirmed ordinary schedule when a pause is removed while retaining agreed exceptions", async () => {
    const { original } = await returnOneToOrdinaryCohort();
    await pause();
    await db.pairing.update({ where: { id: "planning-pairing" }, data: { scheduleConfirmed: false } });
    await remove(original.date);
    const people = await members(original.id);
    expect(people.find((person) => person.tuteeId === "planning-one")).toMatchObject({ status: "SCHEDULED", tutoringPauseSuppressed: false });
    expect(people.find((person) => person.tuteeId === "planning-two")).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: false, calendarSuppressed: true });
    await db.pairing.update({ where: { id: "planning-pairing" }, data: { scheduleConfirmed: true } });
    await ensureSessionPlanningWindow(db, now);
    expect((await members(original.id)).every((person) => person.status === "SCHEDULED")).toBe(true);
  });

  it("previews published participant impact without creating or changing commitments", async () => {
    const { original } = await returnOneToOrdinaryCohort();
    const before = await members(original.id);
    expect(await previewProgramCalendarImpact(db, { date: original.date, endDate: original.date, schedulingEffect: "PAUSE_REGULAR" }, now)).toMatchObject({ scope: "publishedFutureParticipants", pauseCount: 1, retainedExceptionCount: 1, confirmationCount: 0 });
    expect(await members(original.id)).toEqual(before);
  });

  it("shows restoration conflicts as unavailable after pause removal and retries after the dated conflict is released", async () => {
    const original = await source();
    await pause();
    const paused = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
    const extra = await proposeSession(db, tutor, { cohortId: original.id, expectedVersion: paused.version, clientKey: randomUUID(), scope: "ONE", tuteeId: "planning-one", kind: "EXTRA", date: original.date, startMin: original.startMin, online: true });
    await respond(extra.id, one, "ACCEPT");
    await remove(original.date);
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    const blocked = agenda.cohorts.find((row) => row.id === original.id);
    expect(blocked).toMatchObject({ unavailable: true, status: "CANCELLED" });
    expect(blocked).not.toHaveProperty("tutoringPaused");
    expect(blocked).not.toHaveProperty("canArrangeException");
    const extraPlan = await db.sessionPlan.findFirstOrThrow({ where: { kind: "EXTRA" } });
    await db.sessionPlanCohort.updateMany({ where: { planId: extraPlan.id }, data: { status: "CANCELLED" } });
    await db.sessionPlanParticipant.updateMany({ where: { planId: extraPlan.id }, data: { status: "CANCELLED", tutoringPauseSuppressed: false } });
    await ensureSessionPlanningWindow(db, now);
    expect((await members(original.id)).every((person) => person.status === "SCHEDULED" && !person.tutoringPauseSuppressed)).toBe(true);
  });

  it("restores ordinary learners to a changed weekly clock even when an explicit extra now occupies the old clock", async () => {
    const original = await source();
    await pause();
    await db.pairing.update({ where: { id: "planning-pairing" }, data: { startMin: 1000, endMin: 1045 } });
    const paused = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } });
    const extra = await proposeSession(db, tutor, { cohortId: original.id, expectedVersion: paused.version, clientKey: randomUUID(), scope: "ONE", tuteeId: "planning-one", kind: "EXTRA", date: original.date, startMin: original.startMin, online: true });
    await respond(extra.id, one, "ACCEPT");
    await remove(original.date);
    expect(await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ status: "SCHEDULED", startMin: 1000, endMin: 1045 });
    expect((await members(original.id)).every((person) => person.status === "SCHEDULED" && !person.tutoringPauseSuppressed && !person.calendarSuppressed)).toBe(true);
    expect(await db.sessionPlanCohort.count({ where: { plan: { kind: "EXTRA" }, status: "SCHEDULED", startMin: original.startMin } })).toBe(1);
  });
});

describe("automatic dated-room review", () => {
  async function preview(
    overrides: Partial<Parameters<typeof previewSessionLocation>[2]> = {},
    actor = tutor,
  ) {
    const cohort = await source();
    return previewSessionLocation(db, actor, {
      ...time(),
      mode: "propose",
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      scope: "ALL",
      kind: "EXTRA",
      ...overrides,
    });
  }
  it("skips blocked rooms in program order and creates no reservation or consent", async () => {
    await db.room.createMany({
      data: [
        { id: "blocked", name: "A", programOrder: 0 },
        { id: "available", name: "B", programOrder: 1 },
      ],
    });
    await db.roomUnavailability.create({
      data: { roomId: "blocked", dayOfWeek: 2, startMin: 890, endMin: 960 },
    });
    const before = await db.sessionPlanCohort.count();
    expect(await preview()).toEqual({
      roomId: "available",
      roomName: "B",
      online: false,
    });
    expect(await db.sessionPlanningRequest.count()).toBe(0);
    expect(await db.sessionPlanningOffer.count()).toBe(0);
    expect(await db.sessionPlanningSuggestion.count()).toBe(0);
    expect(await db.sessionPlanCohort.count()).toBe(before);
  });
  it("fails without physical rooms but permits an explicit Online proposal", async () => {
    await expect(preview()).rejects.toThrow("No room is available");
    expect(await preview({ online: true })).toEqual({
      roomId: null,
      roomName: null,
      online: true,
    });
  });
  it("does not release the original lesson for an extra and denies unrelated actors", async () => {
    await db.room.create({ data: { id: "room", name: "Room" } });
    const cohort = await source();
    await expect(
      preview({ date: cohort.date, startMin: cohort.startMin }),
    ).rejects.toThrow();
    await expect(
      preview({}, { id: one.id, tutorId: tutor.tutorId }),
    ).rejects.toThrow("Only this active tutor");
    await expect(
      preview({ expectedVersion: cohort.version + 1 }),
    ).rejects.toThrow("session changed");
  });
  it("rechecks the reviewed room at submission without silently substituting another room", async () => {
    await db.room.createMany({
      data: [
        { id: "room-a", name: "A" },
        { id: "room-b", name: "B" },
      ],
    });
    const allocation = await preview();
    await db.roomUnavailability.create({
      data: {
        roomId: allocation.roomId!,
        dayOfWeek: 2,
        startMin: 890,
        endMin: 960,
      },
    });
    const cohort = await source();
    await expect(
      proposeSession(db, tutor, {
        ...time(),
        roomId: allocation.roomId,
        cohortId: cohort.id,
        expectedVersion: cohort.version,
        clientKey: randomUUID(),
        scope: "ALL",
        kind: "EXTRA",
      }),
    ).rejects.toThrow("room is blocked");
    expect(await db.sessionPlanningRequest.count()).toBe(0);
    expect((await preview()).roomId).toBe("room-b");
  });
  it("allocates suggestions and current counteroffers without recording a response", async () => {
    await db.room.create({ data: { id: "room", name: "Room" } });
    expect(
      (
        await preview(
          { mode: "suggest", kind: "RESCHEDULE" },
          { id: one.id, tutorId: "" },
        )
      ).roomId,
    ).toBe("room");
    const { id } = await propose("ALL");
    const { request, offer } = await current(id);
    const allocation = await preview(
      {
        mode: "alternative",
        requestId: id,
        requestVersion: request.version,
        offerId: offer.id,
        date: "2026-11-04",
      },
      { id: one.id, tutorId: "" },
    );
    expect(allocation.roomId).toBe("room");
    expect((await current(id)).offer.id).toBe(offer.id);
    expect(
      (await current(id)).offer.responses.find(
        (row) => row.actorKey === "tutee:planning-one",
      )?.state,
    ).toBe("PENDING");
    await expect(
      preview(
        {
          mode: "alternative",
          requestId: id,
          requestVersion: request.version + 1,
          offerId: offer.id,
        },
        { id: one.id, tutorId: "" },
      ),
    ).rejects.toThrow("no longer available");
  });
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
    const notice = await db.sessionNotice.findFirstOrThrow({ where: { requestId: id, event: "proposed", responseId: { not: null } } });
    expect(notice.context).not.toHaveProperty("requiresExplicitAcceptance");
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
  it.each([
    { label: "forward insertion and relation order", relation: ["planning-one", "planning-two"], legacy: false },
    { label: "reversed insertion and relation order", relation: ["planning-two", "planning-one"], legacy: false },
    { label: "a legacy reversed stored parent", relation: ["planning-two", "planning-one"], legacy: true },
  ])("persists stable new ALL audiences and preserves split evidence with $label", async ({ relation, legacy }) => {
    const original = await source();
    const previous = await db.sessionPlanParticipant.findMany({ where: { planId: original.planId } });
    await db.sessionPlanParticipant.deleteMany({ where: { planId: original.planId } });
    for (const [index, tuteeId] of relation.entries()) {
      const row = previous.find((row) => row.tuteeId === tuteeId)!;
      await db.sessionPlanParticipant.create({ data: { ...row, id: `planning-roster-order-${index}` } });
    }
    const rootId = "planning-roster-order-root";
    await db.recoveryAction.create({ data: {
      id: rootId, kind: "INITIAL_ADMISSION", applicationId: "planning-roster-order-admission", before: {},
    } });
    await db.recoveryTrackedEntity.create({ data: { actionId: rootId, entity: "Tutor", recordId: tutor.tutorId } });

    const observed: string[][] = [];
    // Both permutations are legal results of this unordered relation. Read the
    // real rows, then control only their returned order so the regression does
    // not depend on a particular PostgreSQL plan or generated participant IDs.
    const reordered = db.$extends({ query: { sessionPlanCohort: { async findUnique({ args, query }) {
      const row = await query(args);
      if (row?.id !== original.id || !("plan" in row) || !row.plan || typeof row.plan !== "object" ||
        !("participants" in row.plan) || !Array.isArray(row.plan.participants)) return row;
      const plan = row.plan as Record<string, unknown> & { participants: { tuteeId: string }[] };
      const participants = [...plan.participants].sort((left, right) =>
        relation.indexOf(left.tuteeId) - relation.indexOf(right.tuteeId));
      observed.push(participants.map((person) => person.tuteeId));
      return { ...row, plan: { ...plan, participants } };
    } } } });
    const workflowDb = reordered as unknown as typeof db;
    const audited = async (
      operation: string,
      actor: { id: string },
      work: (tx: typeof db) => Promise<{ id: string }>,
    ) => {
      const result = await runAuditedMutation(workflowDb, {
        id: actor.id, name: "Synthetic roster-order actor", role: actor.id === tutor.id ? "TUTOR" : "STUDENT",
      }, operation, async (tx) => ({ ok: true, value: await work(tx) }));
      return result.value;
    };
    const parent = await audited("sessionPlanning.propose", tutor, (tx) => proposeSession(tx, tutor, {
      cohortId: original.id, expectedVersion: original.version, clientKey: randomUUID(),
      scope: "ALL", kind: "RESCHEDULE", ...time(),
    }));
    expect(observed[0]).toEqual(relation);
    expect((await read(parent.id)).participantIds).toEqual(["planning-one", "planning-two"]);
    // A pre-existing request keeps its captured audience order. Only the new
    // proposal boundary is canonicalized, never a later read or split replay.
    const expected = legacy ? ["planning-two", "planning-one"] : ["planning-one", "planning-two"];
    if (legacy) await db.sessionPlanningRequest.update({ where: { id: parent.id }, data: { participantIds: expected } });
    const first = await current(parent.id);
    await audited("sessionPlanning.respond", one, (tx) => respondSession(tx, one, {
      requestId: parent.id, offerId: first.offer.id, expectedVersion: first.request.version,
      clientKey: randomUUID(), decision: "REJECT", alternative: time("2026-11-04"),
    }));
    const counter = await read(parent.id);
    await audited("sessionPlanning.requestSplit", one, (tx) => requestSeparateSession(tx, one, {
      requestId: parent.id, expectedVersion: counter.version, clientKey: randomUUID(),
    }));
    const split = await read(parent.id);
    await audited("sessionPlanning.formalizeSplit", tutor, (tx) => formalizeSeparateSessions(tx, tutor, {
      requestId: parent.id, expectedVersion: split.version, clientKey: randomUUID(),
    }));
    expect(await read(parent.id)).toMatchObject({ participantIds: expected, status: "SPLIT" });
    const children = await db.sessionPlanningRequest.findMany({
      where: { parentRequestId: parent.id }, include: { offers: true },
    });
    expect(children).toHaveLength(2);
    const childById = new Map(children.map((row) => {
      expect(row.participantIds).toHaveLength(1);
      return [row.id, (row.participantIds as string[])[0]!] as const;
    }));
    const offerIds = new Set(children.flatMap((row) => row.offers.map((offer) => offer.id)));
    const record = (value: unknown): Record<string, unknown> => {
      expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
      return value as Record<string, unknown>;
    };
    const array = (value: unknown): unknown[] => {
      expect(Array.isArray(value)).toBe(true);
      return value as unknown[];
    };
    const learner = (id: unknown) => typeof id === "string" ? childById.get(id) : undefined;
    const journal = await db.recoveryChange.findMany({ where: { actionId: rootId }, orderBy: { id: "asc" } });
    const inserts = (entity: string) => journal.filter((change) => change.entity === entity && change.operation === "INSERT")
      .map((change) => ({ eventId: change.eventId, after: record(change.after) }));
    const childInserts = inserts("SessionPlanningRequest").filter((change) => learner(change.after.id) !== undefined);
    expect(childInserts.map((change) => learner(change.after.id))).toEqual(expected);
    expect(new Set(childInserts.map((change) => change.eventId)).size).toBe(1);
    const expectedRecipients = expected.flatMap((id) => [tutor.id, id === "planning-one" ? one.id : two.id]);
    expect(inserts("SessionPlanningResponse")
      .filter((change) => typeof change.after.offerId === "string" && offerIds.has(change.after.offerId))
      .map((change) => change.after.actorUserId)).toEqual(expectedRecipients);
    expect(inserts("SessionNotice")
      .filter((change) => learner(change.after.requestId) !== undefined)
      .map((change) => change.after.recipientUserId)).toEqual(expectedRecipients);
    expect((await db.recoveryFence.findUniqueOrThrow({ where: { actionId: rootId } })).revision).toBe(journal.length);

    const audit = await db.auditLog.findFirstOrThrow({ where: { operation: "sessionPlanning.formalizeSplit" } });
    const ordinaryAudit = await db.auditLog.findFirstOrThrow({ where: { operation: "sessionPlanning.respond", userId: one.id } });
    const ordinaryEntities = array(record(ordinaryAudit.details).changes).map((change) => record(change).entity);
    expect(ordinaryEntities).toContain("SessionPlanningResponse");
    expect(ordinaryEntities).not.toContain("SessionResponseExecution");
    const auditChildren = array(record(audit.details).changes).map(record)
      .filter((change) => change.entity === "SessionPlanningRequest" && change.write === "create")
      .flatMap((change) => array(change.after).map(record))
      .map((row) => learner(row.id));
    expect(auditChildren).toEqual(expected);
    expect(await db.auditLog.count({ where: { operation: "sessionPlanning.split", entityId: parent.id } })).toBe(1);
    expect(await db.session.count()).toBe(0);
  });

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
  it.each([0, 1, 2])(
    "preserves grouped publication keys and concurrent retries with %i continuation members",
    async (continuingPairings) => {
      await db.$executeRawUnsafe('TRUNCATE "SessionPlan" CASCADE');
      const pairingIds = ["planning-pairing", "planning-second-pairing"];
      const group = await db.pairingGroup.create({
        data: {
          tutorId: tutor.tutorId,
          termId: "planning-term",
          primaryPairingId: pairingIds[0]!,
        },
      });
      await db.pairing.update({
        where: { id: pairingIds[0]! },
        data: { groupId: group.id },
      });
      await db.pairing.create({
        data: {
          id: pairingIds[1]!,
          groupId: group.id,
          tutorId: tutor.tutorId,
          termId: "planning-term",
          subject: "Science",
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
      if (continuingPairings)
        await db.studentContinuationPairing.createMany({
          data: pairingIds.slice(0, continuingPairings).map((pairingId) => ({
            sourcePairingId: `source-${pairingId}`,
            targetTermId: "planning-term",
            pairingId,
          })),
        });
      expect((await ensureSessionPlanningWindow(db, now)).unavailable).toBe(0);
      const plans = await db.sessionPlan.findMany({
        include: { assignments: true, participants: true },
        orderBy: { generationKey: "asc" },
      });
      expect(plans).toHaveLength(2);
      for (const plan of plans) {
        expect(
          plan.generationKey.startsWith(`regular:planning-term:${group.id}:`),
        ).toBe(true);
        expect(plan.generationKey.endsWith(":continuation:0")).toBe(
          continuingPairings === 2,
        );
        expect(plan.assignments.map((row) => row.pairingId).sort()).toEqual(
          [...pairingIds].sort(),
        );
        expect(plan.participants.map((row) => row.tuteeId).sort()).toEqual([
          "planning-one",
          "planning-two",
        ]);
        expect(
          plan.participants.every((row) => row.status === "SCHEDULED"),
        ).toBe(true);
      }
      const notices = await db.sessionNotice.count();
      await Promise.all([
        ensureSessionPlanningWindow(db, now),
        ensureSessionPlanningWindow(db, now),
      ]);
      expect(
        await db.sessionPlan.findMany({
          include: { assignments: true, participants: true },
          orderBy: { generationKey: "asc" },
        }),
      ).toEqual(plans);
      expect(await db.sessionNotice.count()).toBe(notices);
    },
  );

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

describe("bounded conflict evidence queries", () => {
  async function suggestTarget(
    actor = one,
    date = "2026-11-09",
    startMin = 960,
  ) {
    const cohort = await source();
    return suggestSessionTime(db, actor, {
      cohortId: cohort.id,
      expectedVersion: cohort.version,
      clientKey: randomUUID(),
      date,
      startMin,
      online: false,
    });
  }

  async function recurringCandidate(
    id: string,
    exception?: {
      kind: "REGULAR" | "EXTRA";
      originalDate: string;
      cohortDate: string;
      status: "SCHEDULED" | "CANCELLED";
    },
  ) {
    await db.pairing.create({
      data: {
        id,
        tutorId: tutor.tutorId,
        termId: "planning-term",
        subject: "Science",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1005,
        scheduleConfirmed: true,
        roomMode: "NONE",
        tutees: { create: { tuteeId: "planning-two" } },
      },
    });
    if (!exception) return;
    // Seed retained dated evidence directly: public agreement/cancellation lifecycle
    // is covered above; these cases isolate which assignments suppress a default.
    const plan = await db.sessionPlan.create({
      data: {
        generationKey: `conflict-evidence:${id}`,
        tutorId: tutor.tutorId,
        termId: "planning-term",
        originalDate: exception.originalDate,
        timeZone: "Asia/Shanghai",
        kind: exception.kind,
        sourceFingerprint: "synthetic-conflict-evidence",
        assignments: {
          create: {
            pairingId: id,
            subject: "Science",
            tuteeIds: ["planning-two"],
            primary: true,
          },
        },
      },
    });
    const cohort = await db.sessionPlanCohort.create({
      data: {
        planId: plan.id,
        ...plannedWindow(
          { date: exception.cohortDate, startMin: 960, online: false },
          "Asia/Shanghai",
        ),
        rescheduled: exception.cohortDate !== exception.originalDate,
        status: exception.status,
      },
    });
    await db.sessionPlanParticipant.create({
      data: {
        planId: plan.id,
        cohortId: cohort.id,
        tuteeId: "planning-two",
        status: exception.status,
      },
    });
  }

  it("ignores an overlapping historical offer, blocks the current offer and permits touching endpoints", async () => {
    const { id } = await propose();
    await respond(id, one, "REJECT", time("2026-11-04"));
    const { request, offer } = await current(id);
    expect(request.status).toBe("PENDING");
    expect(request.offers).toHaveLength(2);
    expect(offer.date).toBe("2026-11-04");

    // The original Tuesday offer still matches the database relation filter, but
    // Wednesday's current offer is the only reservation this request can hold.
    const historical = await suggestTarget(two, "2026-11-03", 900);
    await expect(suggestTarget(two, "2026-11-04", 900)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That time is held by another pending scheduling request.",
    });
    const before = await suggestTarget(two, "2026-11-04", 855);
    const after = await suggestTarget(two, "2026-11-04", 945);
    const suggestions = await db.sessionPlanningSuggestion.findMany({
      where: { id: { in: [historical.id, before.id, after.id] } },
      orderBy: [{ date: "asc" }, { startMin: "asc" }],
      select: { date: true, startMin: true },
    });
    expect(suggestions).toEqual([
      { date: "2026-11-03", startMin: 900 },
      { date: "2026-11-04", startMin: 855 },
      { date: "2026-11-04", startMin: 945 },
    ]);
    expect((await current(id)).request.currentOfferId).toBe(offer.id);
  });

  it("retains canonical learner conflicts in another tutor's current hold", async () => {
    const other = {
      id: "planning-hold-tutor-user",
      tutorId: "planning-hold-tutor",
    };
    await db.tutor.create({
      data: {
        id: other.tutorId,
        englishName: "Synthetic hold tutor",
        status: "ACTIVE",
      },
    });
    await db.user.create({
      data: {
        id: other.id,
        tutorId: other.tutorId,
        email: "planning-hold-tutor@example.test",
        emailVerifiedAt: now,
        role: "TUTOR",
      },
    });
    const policy = await currentPolicy(db, "tutor-policy");
    await db.policyAcceptance.create({
      data: {
        userId: other.id,
        slug: "tutor-policy",
        revision: policy.revision,
        snapshot: policy.documents,
        signature: "Synthetic hold tutor",
      },
    });
    await db.tutee.create({
      data: {
        id: "planning-one-alias",
        englishName: "Synthetic retained alias",
        status: "ACTIVE",
      },
    });
    await db.studentProfileOwnership.create({
      data: { tuteeId: "planning-one-alias", userId: one.id },
    });
    await db.pairing.create({
      data: {
        id: "planning-alias-hold-pairing",
        tutorId: other.tutorId,
        termId: "planning-term",
        subject: "Science",
        dayOfWeek: 3,
        startMin: 1050,
        endMin: 1095,
        scheduleConfirmed: true,
        roomMode: "NONE",
        tutees: { create: { tuteeId: "planning-one-alias" } },
      },
    });
    await ensureSessionPlanningWindow(db, now);
    const otherSource = await db.sessionPlanCohort.findFirstOrThrow({
      where: { date: "2026-11-04", plan: { tutorId: other.tutorId } },
    });
    const held = await proposeSession(db, other, {
      cohortId: otherSource.id,
      expectedVersion: otherSource.version,
      clientKey: randomUUID(),
      scope: "ONE",
      kind: "RESCHEDULE",
      tuteeId: "planning-one-alias",
      ...time(),
    });
    await expect(suggestTarget(one, "2026-11-03", 900)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That time is held by another pending scheduling request.",
    });
    const unrelated = await suggestTarget(two, "2026-11-03", 900);
    expect(
      await db.sessionPlanningSuggestion.findUniqueOrThrow({
        where: { id: unrelated.id },
      }),
    ).toMatchObject({ tuteeId: "planning-two", date: "2026-11-03" });
    expect((await read(held.id)).status).toBe("PENDING");
  });

  it.each([
    {
      label: "cancelled regular",
      kind: "REGULAR",
      originalDate: "2026-11-09",
      cohortDate: "2026-11-09",
      status: "CANCELLED",
      suppresses: true,
    },
    {
      label: "moved regular",
      kind: "REGULAR",
      originalDate: "2026-11-09",
      cohortDate: "2026-11-10",
      status: "SCHEDULED",
      suppresses: true,
    },
    {
      label: "cancelled extra",
      kind: "EXTRA",
      originalDate: "2026-11-09",
      cohortDate: "2026-11-09",
      status: "CANCELLED",
      suppresses: false,
    },
    {
      label: "another original date",
      kind: "REGULAR",
      originalDate: "2026-11-02",
      cohortDate: "2026-11-09",
      status: "CANCELLED",
      suppresses: false,
    },
  ] as const)(
    "uses $label evidence only for the matching regular recurrence",
    async (scenario) => {
      await recurringCandidate("planning-materialized-candidate", scenario);
      if (scenario.suppresses) {
        const result = await suggestTarget();
        expect(
          await db.sessionPlanningSuggestion.findUniqueOrThrow({
            where: { id: result.id },
          }),
        ).toMatchObject({ date: "2026-11-09", startMin: 960 });
      } else {
        await expect(suggestTarget()).rejects.toMatchObject({
          code: "CONFLICT",
          message: "That time conflicts with a recurring assignment.",
        });
        expect(await db.sessionPlanningSuggestion.count()).toBe(0);
      }
    },
  );

  it("does not let one materialized assignment suppress an unmaterialized conflict in the same batch", async () => {
    await recurringCandidate("planning-materialized-candidate", {
      kind: "REGULAR",
      originalDate: "2026-11-09",
      cohortDate: "2026-11-09",
      status: "CANCELLED",
    });
    await recurringCandidate("planning-unmaterialized-candidate");
    await expect(suggestTarget()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That time conflicts with a recurring assignment.",
    });
    expect(await db.sessionPlanningSuggestion.count()).toBe(0);
  });
});

describe("planned agenda history", () => {
  async function ended(
    id: string,
    patch: { startsAt?: Date; status?: string; planId?: string } = {},
  ) {
    const original = await source();
    const startsAt = patch.startsAt ?? new Date("2026-10-20T07:00:00Z");
    return db.sessionPlanCohort.create({
      data: {
        id,
        planId: patch.planId ?? original.planId,
        date: startsAt.toISOString().slice(0, 10),
        startMin: 900,
        endMin: 945,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60_000),
        status: patch.status ?? "CANCELLED",
      },
    });
  }

  it("pages ended planned cohorts in stable descending order with an honest final cursor", async () => {
    const same = new Date("2026-10-20T07:00:00Z");
    await ended("history-a", { startsAt: same });
    await ended("history-b", { startsAt: same });
    await ended("history-older", {
      startsAt: new Date("2026-10-19T07:00:00Z"),
    });
    const first = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
      limit: 1,
    });
    expect(first.cohorts.map((row) => row.id)).toEqual(["history-b"]);
    expect(first.nextCursor).toEqual({ startsAt: same, id: "history-b" });
    const second = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.cohorts.map((row) => row.id)).toEqual(["history-a"]);
    const last = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
      limit: 1,
      cursor: second.nextCursor!,
    });
    expect(last.cohorts.map((row) => row.id)).toEqual(["history-older"]);
    expect(last.nextCursor).toBeNull();
    expect(first.cohorts.every((row) => !row.canRecordAttendance)).toBe(true);
    expect(first.cohorts.some((row) => row.date >= "2026-10-26")).toBe(false);
  });

  it("retains captured cancelled subjects and participants without reconstructing the live pairing", async () => {
    await ended("cancelled-source");
    await db.pairing.update({
      where: { id: "planning-pairing" },
      data: { subject: "Changed live subject" },
    });
    const result = await readSessionAgendaHistory(db, tutor, { role: "tutor" });
    expect(result.cohorts[0]).toMatchObject({
      id: "cancelled-source",
      subjects: ["Math"],
      status: "CANCELLED",
      canRecordAttendance: false,
    });
    expect(result.cohorts[0]!.tutees.map((person) => person.id).sort()).toEqual(
      ["planning-one", "planning-two"],
    );
    const personal = await readSessionAgendaHistory(db, one, { role: "tutee" });
    expect(personal.cohorts[0]!.tutees).toEqual([
      { id: "planning-one", name: "Synthetic One" },
    ]);
    expect(JSON.stringify(personal)).not.toContain("Synthetic Two");
  });

  it("reads history without publishing a new window, expiring requests or writing receipts", async () => {
    const request = await propose();
    const counts = async () => ({
      plans: await db.sessionPlan.count(),
      cohorts: await db.sessionPlanCohort.count(),
      notices: await db.sessionNotice.count(),
      receipts: await db.sessionPlanningReceipt.count(),
    });
    const before = await counts();
    await readSessionAgendaHistory(
      db,
      tutor,
      { role: "tutor" },
      new Date("2026-12-20T00:00:00Z"),
    );
    expect(await counts()).toEqual(before);
    expect((await read(request.id)).status).toBe("PENDING");
    expect(await db.session.count()).toBe(0);
  });

  it("preserves exact personal history independently of revoked live participation", async () => {
    const row = await ended("peer-only");
    await db.sessionPlanParticipant.update({
      where: {
        planId_tuteeId: { planId: row.planId, tuteeId: "planning-two" },
      },
      data: { cohortId: row.id },
    });
    expect(
      (await readSessionAgendaHistory(db, one, { role: "tutee" })).cohorts,
    ).toEqual([]);
    expect(
      (await readSessionAgendaHistory(db, two, { role: "tutee" })).cohorts.map(
        (item) => item.id,
      ),
    ).toEqual([row.id]);
    await db.user.update({
      where: { id: tutor.id },
      data: { tutorAccessRevoked: true },
    });
    const retained = await readSessionAgendaHistory(db, tutor, { role: "tutor" });
    expect(retained.cohorts.map((item) => item.id)).toEqual([row.id]);
    expect(retained.cohorts.every((item) => !item.canRecordAttendance)).toBe(true);
    await expect(readSessionAgenda(db, tutor, "tutor")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(propose()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // An unrelated account receives no tutor history merely by selecting that
    // history role; explicit retained ownership survives clearing the live link.
    expect((await readSessionAgendaHistory(db, one, { role: "tutor" })).cohorts).toEqual([]);
    await db.tutorProfileOwnership.create({ data: { tutorId: tutor.tutorId, userId: tutor.id } });
    await db.user.update({ where: { id: tutor.id }, data: { tutorId: null } });
    expect((await readSessionAgendaHistory(db, tutor, { role: "tutor" })).cohorts.map((item) => item.id)).toEqual([row.id]);
    await db.user.update({ where: { id: two.id }, data: { tuteeMember: false } });
    expect((await readSessionAgendaHistory(db, two, { role: "tutee" })).cohorts.map((item) => item.id)).toEqual([row.id]);
    await expect(readSessionAgenda(db, two, "tutee")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.user.update({ where: { id: tutor.id }, data: { suspendedAt: now } });
    await expect(readSessionAgendaHistory(db, tutor, { role: "tutor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps current-window sessions visible beyond a full overdue attendance backlog", async () => {
    const original = await source();
    const old = new Date("2026-10-01T07:00:00Z");
    const plan = await db.sessionPlan.findUniqueOrThrow({
      where: { id: original.planId },
    });
    const batch = Array.from({ length: 301 }, (_, index) =>
      String(index).padStart(3, "0"),
    );
    await db.sessionPlan.createMany({
      data: batch.map((key) => ({
        id: `backlog-plan-${key}`,
        generationKey: `history-backlog-${key}`,
        tutorId: plan.tutorId,
        termId: plan.termId,
        originalDate: "2026-10-01",
        timeZone: plan.timeZone,
        sourceFingerprint: plan.sourceFingerprint,
        sourceScheduleFingerprint: plan.sourceScheduleFingerprint,
      })),
    });
    await db.sessionPlanAssignment.createMany({
      data: batch.map((key) => ({
        planId: `backlog-plan-${key}`,
        pairingId: "planning-pairing",
        subject: "Math",
        tuteeIds: ["planning-one", "planning-two"],
        primary: true,
      })),
    });
    await db.sessionPlanCohort.createMany({
      data: batch.map((key) => ({
        id: `backlog-${key}`,
        planId: `backlog-plan-${key}`,
        date: "2026-10-01",
        startMin: 900 + Number(key),
        endMin: 945 + Number(key),
        startsAt: new Date(old.getTime() + Number(key) * 60_000),
        endsAt: new Date(old.getTime() + (Number(key) + 45) * 60_000),
        status: "SCHEDULED",
      })),
    });
    await db.sessionPlanParticipant.createMany({
      data: batch.flatMap((key) =>
        ["planning-one", "planning-two"].map((tuteeId) => ({
          planId: `backlog-plan-${key}`,
          cohortId: `backlog-${key}`,
          tuteeId,
        })),
      ),
    });
    const agenda = await readSessionAgenda(db, tutor, "tutor");
    expect(agenda.attendanceBacklogHasMore).toBe(true);
    expect(agenda.cohorts.some((item) => item.id === "backlog-300")).toBe(true);
    expect(agenda.cohorts.some((item) => item.id === "backlog-000")).toBe(
      false,
    );
    expect(agenda.cohorts.some((item) => item.id === original.id)).toBe(true);
    expect(
      agenda.cohorts
        .filter((item) => item.id.startsWith("backlog-"))
        .every((item) => item.needsAttendance),
    ).toBe(true);
    expect(
      agenda.cohorts.filter((item) => item.id.startsWith("backlog-")),
    ).toHaveLength(300);
    expect(new Set(agenda.cohorts.map((item) => item.id)).size).toBe(
      agenda.cohorts.length,
    );
    const history = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
      limit: 50,
    });
    expect(history.cohorts).toHaveLength(50);
    expect(history.nextCursor).not.toBeNull();
    await db.session.create({
      data: {
        planningCohortId: "backlog-300",
        pairingId: "planning-pairing",
        tutorId: tutor.tutorId,
        date: old,
        startMin: 1200,
        endMin: 1245,
        durationMin: 45,
        shFactor: 1,
        shCount: 0.75,
        month: "2026-10",
        schoolYear: "26-27",
        quarter: "Q1",
      },
    });
    const refreshed = await readSessionAgenda(db, tutor, "tutor");
    expect(refreshed.attendanceBacklogHasMore).toBe(false);
    expect(refreshed.cohorts.some((item) => item.id === "backlog-000")).toBe(
      true,
    );
    expect(refreshed.cohorts.some((item) => item.id === "backlog-300")).toBe(
      false,
    );
  });

  it("includes agreed future extras beyond the publication window only when All is requested", async () => {
    const request = await propose("ONE", "EXTRA", "2026-11-20");
    await respond(request.id, one, "ACCEPT");
    const extra = await db.sessionPlanCohort.findFirstOrThrow({
      where: { date: "2026-11-20", plan: { kind: "EXTRA" } },
    });
    const history = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
    });
    expect(history.cohorts.some((item) => item.id === extra.id)).toBe(false);
    const all = await readSessionAgendaHistory(db, tutor, {
      role: "tutor",
      view: "all",
    });
    expect(all.cohorts.find((item) => item.id === extra.id)).toMatchObject({
      kind: "EXTRA",
      date: "2026-11-20",
      status: "SCHEDULED",
      canRecordAttendance: false,
    });
  });
});

it("retains pending request source cohorts beyond the displayed week and backlog bounds", async () => {
  const original = await source();
  const request = await propose();
  const agenda = await readSessionAgenda(
    db,
    tutor,
    "tutor",
    new Date("2026-10-12T00:00:00Z"),
  );
  expect(original.date > agenda.windowEnd).toBe(true);
  expect(agenda.requests.some((item) => item.id === request.id)).toBe(true);
  expect(agenda.cohorts.some((item) => item.id === original.id)).toBe(true);
});
