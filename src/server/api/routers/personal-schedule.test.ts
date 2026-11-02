import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCallerFactory, createTRPCRouter } from "../trpc";
import { personalScheduleRouter } from "./personal-schedule";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import type { PersonalScheduleCursor } from "~/lib/personal-schedule";

const createCaller = createCallerFactory(
  createTRPCRouter({ personalSchedule: personalScheduleRouter }),
);
const now = new Date("2026-10-28T08:00:00Z");
const caller = (id = "owner") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role: "ADMIN",
      tutorId: "mine",
      expires: "2099-01-01",
    },
  }).personalSchedule;

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await db.tutor.createMany({
    data: [
      { id: "mine", englishName: "Synthetic owner" },
      { id: "other", englishName: "Synthetic other" },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: "owner",
        email: "owner@example.test",
        role: "ADMIN",
        tutorId: "mine",
      },
      {
        id: "other",
        email: "other@example.test",
        role: "TUTOR",
        tutorId: "other",
      },
      { id: "unlinked", email: "unlinked@example.test", role: "VIEWER" },
    ],
  });
  await db.term.createMany({
    data: [
      {
        id: "current",
        name: "Current",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
      { id: "old", name: "Old", schoolYear: "25-26", quarter: "Q4" },
    ],
  });
  await db.subject.create({
    data: { id: "subject", name: "Synthetic subject" },
  });
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function application(
  id: string,
  date: string | null,
  options: {
    status?: "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED" | "RECALLED";
    invalid?: boolean;
    completed?: boolean;
    other?: boolean;
    isHead?: boolean;
  } = {},
) {
  return db.tutorApplication.create({
    data: {
      id,
      createdAt: now,
      name: `Synthetic ${id}`,
      email: `private-${id}@example.test`,
      preferredContact: "Private contact",
      decisionComment: "Private decision comment",
      status: options.status ?? "INTERVIEW",
      // Recall belongs to an existing tutor's qualification request and keeps
      // its applicant/subject identity plus explicit actor/time evidence.
      ...(options.status === "RECALLED"
        ? {
            type: "ADDITIONAL_SUBJECT" as const,
            requestedTutorId: "other",
            requestedSubjectId: "subject",
            recalledAt: now,
            recalledById: "other",
          }
        : {}),
      interviewAt: date ? new Date(date) : null,
      interviewCompletedAt: options.completed ? now : null,
      invalidatedAt: options.invalid ? now : null,
      qualificationReason: "Private qualification reason",
      subjectIntents: {
        create: { subjectId: "subject", grade: "Private grade" },
      },
      interviewers: {
        create: {
          tutorId: options.other ? "other" : "mine",
          isHead: options.isHead ?? true,
        },
      },
    },
  });
}

it("projects only assigned valid appointments in current+next school weeks, with no duration or private evidence", async () => {
  await application("start", "2026-10-28T08:00:00Z");
  await application("past-in-window", "2026-10-25T16:00:00Z");
  await application("last", "2026-11-08T15:59:59Z");
  await application("outside", "2026-11-08T16:00:00Z");
  await application("other", "2026-10-29T08:00:00Z", { other: true });
  await application("paused", "2026-10-29T08:00:00Z", { invalid: true });
  await application("recalled", "2026-10-29T08:00:00Z", { status: "RECALLED" });
  await db.interviewVote.create({
    data: {
      applicationId: "start",
      tutorId: "mine",
      accept: true,
      comment: "Private vote",
    },
  });
  const result = await caller().interviews();
  expect(result.window).toEqual({
    start: "2026-10-26",
    end: "2026-11-08",
    timeZone: "Asia/Shanghai",
  });
  expect(result.appointments.map((row) => row.id)).toEqual(["start", "last"]);
  expect(result.appointments[0]).toEqual({
    id: "start",
    name: "Synthetic start",
    subjects: ["Synthetic subject"],
    interviewAt: now,
    isHead: true,
    canChair: true,
    status: "INTERVIEW",
    completionState: "pending",
    ownVoteRecorded: true,
    startsAt: now,
    sortAt: now,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private|Private|email|votes|qualificationReason|decisionComment|duration|endsAt/,
  );
  expect(await db.interviewVote.count()).toBe(1);
  expect(await db.serviceHourAdjustment.count()).toBe(0);
});

it("retains unscheduled, past-open, completed-but-open and decided completion follow-ups as separate tasks", async () => {
  await application("unscheduled", null);
  await application("past", "2026-10-15T08:00:00Z");
  await application("completed-open", "2026-10-15T08:00:00Z", {
    completed: true,
  });
  await application("completion-needed", "2026-10-15T08:00:00Z", {
    status: "ACCEPTED",
  });
  await application("finished", "2026-10-15T08:00:00Z", {
    status: "ACCEPTED",
    completed: true,
  });
  const result = await caller().interviews();
  expect(result.appointments).toEqual([]);
  expect(
    result.tasks.map(({ id, reason, completionState }) => ({
      id,
      reason,
      completionState,
    })),
  ).toEqual(
    expect.arrayContaining([
      { id: "unscheduled", reason: "unscheduled", completionState: "pending" },
      { id: "past", reason: "pastOpen", completionState: "pending" },
      {
        id: "completed-open",
        reason: "pastOpen",
        completionState: "completed",
      },
      {
        id: "completion-needed",
        reason: "completionNeeded",
        completionState: "pending",
      },
    ]),
  );
  expect(result.tasks).toHaveLength(4);
  await db.user.update({
    where: { id: "owner" },
    data: { role: "COORDINATOR" },
  });
  expect(
    (await caller().interviews()).tasks.every(
      (row) => row.isHead && !row.canChair,
    ),
  ).toBe(true);
});

it("reflects rescheduling and assignment replacement without cached identities or writes", async () => {
  await application("changing", "2026-10-29T08:00:00Z");
  expect((await caller().interviews()).appointments).toHaveLength(1);
  await db.tutorApplication.update({
    where: { id: "changing" },
    data: { interviewAt: new Date("2026-11-09T08:00:00Z") },
  });
  expect((await caller().interviews()).appointments).toEqual([]);
  await db.interviewAssignment.update({
    where: {
      applicationId_tutorId: { applicationId: "changing", tutorId: "mine" },
    },
    data: { tutorId: "other" },
  });
  expect((await caller().interviews()).tasks).toEqual([]);
});

it("keeps meeting eligibility identical to personal source history and never projects reasons", async () => {
  await db.tutorMeeting.createMany({
    data: [
      {
        id: "own-history",
        title: "Own history",
        date: new Date("2026-10-26T08:00:00Z"),
        termId: "old",
      },
      {
        id: "other-history",
        title: "Private other history",
        date: new Date("2026-10-26T08:00:00Z"),
        termId: "old",
      },
      {
        id: "current-history",
        title: "Current history",
        date: new Date("2026-10-26T08:00:00Z"),
        termId: "current",
      },
      { id: "cutoff", title: "Cutoff", date: new Date("2026-10-28T09:00:00Z") },
      { id: "late", title: "Late", date: new Date("2026-10-28T08:59:59Z") },
      {
        id: "outside",
        title: "Outside",
        date: new Date("2026-11-08T16:00:00Z"),
      },
    ],
  });
  await db.meetingAttendance.createMany({
    data: [
      {
        meetingId: "own-history",
        tutorId: "mine",
        status: "PRESENT",
        reason: "Private own reason",
      },
      {
        meetingId: "own-history",
        tutorId: "other",
        status: "PRESENT",
        reason: "Private other reason",
      },
      { meetingId: "other-history", tutorId: "other", status: "PRESENT" },
      {
        meetingId: "cutoff",
        tutorId: "mine",
        status: "EXCUSED_ABSENT",
        excusedAt: now,
        reason: "Private excuse",
      },
    ],
  });
  const result = await caller().meetings();
  expect(result.appointments.map((row) => row.id)).toEqual(["late", "cutoff"]);
  expect(result.appointments.find((row) => row.id === "cutoff")).toMatchObject({
    excused: true,
    canExcuse: true,
  });
  expect(result.appointments.find((row) => row.id === "late")?.canExcuse).toBe(
    false,
  );
  expect(JSON.stringify(result)).not.toMatch(/reason|Private|endsAt|duration/);
  expect(
    (await caller().meetings({ view: "history" })).appointments.map(
      (row) => row.id,
    ),
  ).toEqual(["own-history", "current-history"]);
  expect(
    (await caller().meetingDetail({ meetingId: "own-history" })).reason,
  ).toBe("Private own reason");
  await expect(
    caller().meetingDetail({ meetingId: "other-history" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await caller().meetingDetail({ meetingId: "outside" })).title).toBe(
    "Outside",
  );
  expect(await db.meetingAttendance.count()).toBe(4);
});

it("uses the newly saved school timezone for both independent reads", async () => {
  vi.setSystemTime(new Date("2026-11-01T23:00:00Z"));
  await db.programSettings.create({ data: { timeZone: "America/New_York" } });
  expect((await caller().interviews()).window.start).toBe("2026-10-26");
  expect((await caller().meetings()).window.start).toBe("2026-10-26");
  await db.programSettings.update({
    where: { id: "program" },
    data: { timeZone: "Asia/Shanghai" },
  });
  expect((await caller().interviews()).window.start).toBe("2026-11-02");
});

it("rechecks active linkage, suspension and effective source flags independently", async () => {
  await db.programFeature.create({
    data: { key: "INTERVIEWS", enabled: false },
  });
  await expect(caller().interviews()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect((await caller().meetings()).appointments).toEqual([]);
  await db.programFeature.create({ data: { key: "MEETINGS", enabled: false } });
  await expect(caller().meetings()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller().meetingDetail({ meetingId: "unknown" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.programFeature.deleteMany();
  await db.tutor.update({ where: { id: "mine" }, data: { status: "PENDING" } });
  await expect(caller().interviews()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(caller().meetings()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.tutor.update({ where: { id: "mine" }, data: { status: "ACTIVE" } });
  await expect(caller("unlinked").meetings()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await db.user.update({ where: { id: "owner" }, data: { suspendedAt: now } });
  await expect(caller().interviews()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("pages dated interview views in a deterministic total order and keeps undated work separate", async () => {
  await application("a", "2026-10-29T08:00:00Z");
  await application("b", "2026-10-29T08:00:00Z");
  await application("c", "2026-10-30T08:00:00Z");
  await application("past", "2026-10-15T08:00:00Z");
  await application("terminal", "2026-11-02T08:00:00Z", {
    status: "ACCEPTED",
    completed: true,
  });
  await application("undated", null, { status: "ACCEPTED" });
  await application("other", "2026-10-29T08:00:00Z", { other: true });
  const first = await caller().interviews({ limit: 1 });
  expect(first.appointments.map((row) => row.id)).toEqual(["a"]);
  expect(first.pageInfo).toEqual({
    hasMore: true,
    nextCursor: { at: new Date("2026-10-29T08:00:00Z"), id: "a" },
  });
  // Keyset continuation is an immutable tuple, not a lookup of a retained row.
  await db.interviewAssignment.delete({
    where: { applicationId_tutorId: { applicationId: "a", tutorId: "mine" } },
  });
  const second = await caller().interviews({
    limit: 1,
    cursor: first.pageInfo.nextCursor!,
  });
  expect(second.appointments.map((row) => row.id)).toEqual(["b"]);
  const third = await caller().interviews({
    limit: 1,
    cursor: second.pageInfo.nextCursor!,
  });
  expect(third.appointments.map((row) => row.id)).toEqual(["c"]);
  expect(third.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  expect(
    (await caller().interviews({ view: "history" })).appointments.map(
      (row) => row.id,
    ),
  ).toEqual(["terminal", "past"]);
  const all: string[] = [];
  let cursor: PersonalScheduleCursor | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await caller().interviews({ view: "all", limit: 2, cursor });
    all.push(...result.appointments.map((row) => row.id));
    if (!result.pageInfo.hasMore) break;
    cursor = result.pageInfo.nextCursor!;
  }
  expect(all).toEqual(["terminal", "c", "b", "past"]);
  expect(
    (await caller().interviews()).tasks.some((row) => row.id === "undated"),
  ).toBe(true);
  await expect(caller().interviews({ limit: 51 })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("pages unresolved context independently and computes the top three actions before either page limit", async () => {
  for (const id of ["task-a", "task-b", "task-c", "task-d", "task-e"]) {
    await application(id, null, { status: "PENDING" });
  }
  const first = await caller().interviews({ limit: 2 });
  expect(first.appointments).toEqual([]);
  expect(first.tasks.map((row) => row.id)).toEqual(["task-e", "task-d"]);
  expect(first.taskPageInfo.hasMore).toBe(true);
  expect(
    first.actionableTasks.map(({ id, action }) => ({ id, action })),
  ).toEqual([
    { id: "task-e", action: "schedule" },
    { id: "task-d", action: "schedule" },
    { id: "task-c", action: "schedule" },
  ]);
  expect(first.hasMoreActionableTasks).toBe(true);
  const second = await caller().interviews({
    view: "history",
    limit: 2,
    taskCursor: first.taskPageInfo.nextCursor!,
  });
  expect(second.tasks.map((row) => row.id)).toEqual(["task-c", "task-b"]);
  expect(second.actionableTasks).toEqual(first.actionableTasks);
  const last = await caller().interviews({
    limit: 2,
    taskCursor: second.taskPageInfo.nextCursor!,
  });
  expect(last.tasks.map((row) => row.id)).toEqual(["task-a"]);
  expect(last.taskPageInfo).toEqual({ hasMore: false, nextCursor: null });
});

it("only requests an assigned tutor's missing vote or an authorized chair's unscheduled time", async () => {
  await application("needs-vote", "2026-10-29T08:00:00Z", { isHead: false });
  await application("already-voted", "2026-10-29T08:00:00Z", { isHead: false });
  await application("awaiting-chair", "2026-10-15T08:00:00Z", {
    isHead: false,
    completed: true,
  });
  await application("schedule-chair", null, { status: "PENDING" });
  await application("schedule-panelist", null, {
    status: "PENDING",
    isHead: false,
  });
  await application("completion-panelist", "2026-10-15T08:00:00Z", {
    status: "ACCEPTED",
    isHead: false,
  });
  await application("invalid", "2026-10-29T08:00:00Z", {
    invalid: true,
    isHead: false,
  });
  await application("other-private", "2026-10-29T08:00:00Z", { other: true });
  await db.interviewVote.createMany({
    data: [
      {
        applicationId: "already-voted",
        tutorId: "mine",
        accept: true,
        comment: "Private own comment",
      },
      { applicationId: "awaiting-chair", tutorId: "mine", accept: false },
    ],
  });
  const result = await caller().interviews();
  expect(
    result.actionableTasks.map(({ id, action }) => ({ id, action })),
  ).toEqual([
    { id: "schedule-chair", action: "schedule" },
    { id: "needs-vote", action: "vote" },
  ]);
  expect(
    result.appointments.find((row) => row.id === "already-voted")
      ?.ownVoteRecorded,
  ).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /Private|private-|comment|accept"|email|qualificationReason/,
  );
  await db.user.update({ where: { id: "owner" }, data: { role: "TUTOR" } });
  expect(
    (await caller().interviews()).actionableTasks.map((row) => row.id),
  ).toEqual(["needs-vote"]);
});

async function completePanel(applicationId: string, ownIsHead = true) {
  await db.interviewAssignment.createMany({
    data: [
      { applicationId, tutorId: "other", isHead: !ownIsHead },
      { applicationId, tutorId: "third" },
    ],
  });
}

it("only offers decision/completion review with live source permissions, panel evidence and feature availability", async () => {
  await db.tutor.create({
    data: { id: "third", englishName: "Third panelist" },
  });
  await db.user.create({
    data: {
      id: "third",
      email: "third@example.test",
      role: "TUTOR",
      tutorId: "third",
    },
  });
  await db.user.update({ where: { id: "other" }, data: { role: "ADMIN" } });
  await db.tutorQualification.create({
    data: { tutorId: "mine", subjectId: "subject", approvedById: "owner" },
  });
  await db.qualificationGrant.create({
    data: { tutorId: "mine", sourceSubjectId: "subject", subjectId: "subject" },
  });
  await application("decision", "2026-10-15T08:00:00Z", { completed: true });
  await completePanel("decision");
  await db.interviewVote.createMany({
    data: ["mine", "other", "third"].map((tutorId) => ({
      applicationId: "decision",
      tutorId,
      accept: true,
    })),
  });
  await application("completion", "2026-10-15T08:00:00Z", {
    status: "ACCEPTED",
    isHead: false,
  });
  await completePanel("completion", false);
  await application("bad-panel", "2026-10-15T08:00:00Z", {
    status: "ACCEPTED",
  });
  expect(
    (await caller().interviews()).actionableTasks.map(({ id, action }) => ({
      id,
      action,
    })),
  ).toEqual([
    { id: "decision", action: "decision" },
    { id: "completion", action: "completion" },
  ]);
  await db.interviewVote.delete({
    where: {
      applicationId_tutorId: { applicationId: "decision", tutorId: "third" },
    },
  });
  expect(
    (await caller().interviews()).actionableTasks.map((row) => row.id),
  ).toEqual(["completion"]);
  await db.interviewVote.create({
    data: { applicationId: "decision", tutorId: "third", accept: true },
  });
  await db.tutorQualification.update({
    where: { tutorId_subjectId: { tutorId: "mine", subjectId: "subject" } },
    data: { status: "PENDING" },
  });
  expect((await caller().interviews()).actionableTasks).toEqual([]);
  await db.tutorQualification.update({
    where: { tutorId_subjectId: { tutorId: "mine", subjectId: "subject" } },
    data: { status: "APPROVED" },
  });
  await db.programFeature.create({
    data: { key: "SERVICE_HOURS", enabled: false },
  });
  expect(
    (await caller().interviews()).actionableTasks.map((row) => row.id),
  ).toEqual(["decision"]);
  await db.programFeature.deleteMany();
  await db.approvalRequest.create({
    data: {
      requesterId: "owner",
      requesterName: "Synthetic owner",
      operation: "tutor.decideInterview",
      payload: { json: { applicationId: "decision" } },
      fingerprint: "synthetic-decision",
      targets: [],
    },
  });
  expect(
    (await caller().interviews()).actionableTasks.map((row) => row.id),
  ).toEqual(["completion"]);
  await db.user.update({ where: { id: "owner" }, data: { role: "TUTOR" } });
  expect((await caller().interviews()).actionableTasks).toEqual([]);
  await db.user.update({ where: { id: "owner" }, data: { role: "ADMIN" } });
  await db.tutor.update({
    where: { id: "third" },
    data: { status: "PENDING" },
  });
  expect((await caller().interviews()).actionableTasks).toEqual([]);
});

it("pages all personal meeting records while future review tasks exclude recorded, out-of-window and cutoff states", async () => {
  await db.tutorMeeting.createMany({
    data: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `future-${i}`,
        title: `Synthetic meeting ${i}`,
        date: new Date("2026-10-29T08:00:00Z"),
      })),
      {
        id: "far-future",
        title: "Later source meeting",
        date: new Date("2026-11-15T08:00:00Z"),
      },
      {
        id: "too-late",
        title: "Cutoff passed",
        date: new Date("2026-10-28T08:59:59Z"),
      },
      {
        id: "own-past",
        title: "Own historical evidence",
        date: new Date("2026-10-01T08:00:00Z"),
        termId: "old",
      },
      {
        id: "other-past",
        title: "Private other evidence",
        date: new Date("2026-10-01T08:00:00Z"),
        termId: "old",
      },
    ],
  });
  await db.meetingAttendance.createMany({
    data: [
      { meetingId: "future-1", tutorId: "mine", status: "EXEMPT" },
      { meetingId: "future-2", tutorId: "mine", status: "PRESENT" },
      {
        meetingId: "future-4",
        tutorId: "mine",
        status: "EXCUSED_ABSENT",
        excusedAt: now,
      },
      {
        meetingId: "own-past",
        tutorId: "mine",
        status: "PRESENT",
        reason: "Private own reason",
      },
      {
        meetingId: "other-past",
        tutorId: "other",
        status: "PRESENT",
        reason: "Private other reason",
      },
    ],
  });
  const first = await caller().meetings({ limit: 2 });
  expect(first.appointments.map((row) => row.id)).toEqual([
    "too-late",
    "future-0",
  ]);
  expect(first.pageInfo.hasMore).toBe(true);
  expect(
    first.actionableTasks.map(({ id, action }) => ({ id, action })),
  ).toEqual([
    { id: "future-0", action: "reviewMeeting" },
    { id: "future-3", action: "reviewMeeting" },
    { id: "future-5", action: "reviewMeeting" },
  ]);
  expect(first.hasMoreActionableTasks).toBe(true);
  expect(
    (await caller().meetings({ view: "history" })).appointments.map(
      (row) => row.id,
    ),
  ).toEqual(["own-past"]);
  const all: string[] = [];
  let cursor: PersonalScheduleCursor | undefined;
  for (let page = 0; page < 8; page++) {
    const result = await caller().meetings({ view: "all", limit: 2, cursor });
    all.push(...result.appointments.map((row) => row.id));
    expect(result.actionableTasks).toEqual(first.actionableTasks);
    if (!result.pageInfo.hasMore) break;
    cursor = result.pageInfo.nextCursor!;
  }
  expect(all).toEqual([
    "far-future",
    "future-6",
    "future-5",
    "future-4",
    "future-3",
    "future-2",
    "future-1",
    "future-0",
    "too-late",
    "own-past",
  ]);
  expect(JSON.stringify(await caller().meetings({ view: "all" }))).not.toMatch(
    /Private|reason|duration|endsAt/,
  );
  await expect(caller().meetings({ limit: 0 })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

it("skips unresolved-work, readiness SQL and extra feature reads on event-only pages", async () => {
  await application("event", "2026-10-29T08:00:00Z");
  await application("task", null, { status: "PENDING" });
  await db.tutorMeeting.create({
    data: {
      id: "event-meeting",
      title: "Event meeting",
      date: new Date("2026-10-29T08:00:00Z"),
    },
  });
  const assignmentReads = vi.spyOn(db.interviewAssignment, "findMany");
  const readinessReads = vi.spyOn(db, "$queryRaw");
  const featureReads = vi.spyOn(db.programFeature, "findMany");
  const meetingReads = vi.spyOn(db.tutorMeeting, "findMany");
  try {
    const events = await caller().interviews({ includeSummary: false });
    expect(events.appointments.map((row) => row.id)).toEqual(["event"]);
    expect(events.tasks).toEqual([]);
    expect(events.actionableTasks).toEqual([]);
    expect(events.hasMoreActionableTasks).toBe(false);
    expect(events.taskPageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(assignmentReads).toHaveBeenCalledOnce();
    expect(readinessReads).not.toHaveBeenCalled();
    expect(featureReads).toHaveBeenCalledOnce();
    const meetings = await caller().meetings({ includeSummary: false });
    expect(meetings.appointments.map((row) => row.id)).toEqual([
      "event-meeting",
    ]);
    expect(meetings.actionableTasks).toEqual([]);
    expect(meetingReads).toHaveBeenCalledOnce();
    const overview = await caller().interviews();
    expect(overview.tasks.map((row) => row.id)).toEqual(["task"]);
    expect(
      overview.actionableTasks.some((row) => row.action === "schedule"),
    ).toBe(true);
    expect(readinessReads).toHaveBeenCalledOnce();
  } finally {
    assignmentReads.mockRestore();
    readinessReads.mockRestore();
    featureReads.mockRestore();
    meetingReads.mockRestore();
  }
});
