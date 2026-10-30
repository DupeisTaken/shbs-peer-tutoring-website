import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCallerFactory, createTRPCRouter } from "../trpc";
import { personalScheduleRouter } from "./personal-schedule";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

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
  } = {},
) {
  return db.tutorApplication.create({
    data: {
      id,
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
        create: { tutorId: options.other ? "other" : "mine", isHead: true },
      },
    },
  });
}

it("projects only assigned valid appointments in current+next school weeks, with no duration or private evidence", async () => {
  await application("start", "2026-10-25T16:00:00Z");
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
    interviewAt: new Date("2026-10-25T16:00:00Z"),
    isHead: true,
    canChair: true,
    status: "INTERVIEW",
    completionState: "pending",
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
  expect(result.appointments.map((row) => row.id)).toEqual([
    "current-history",
    "own-history",
    "late",
    "cutoff",
  ]);
  expect(result.appointments.find((row) => row.id === "cutoff")).toMatchObject({
    excused: true,
    canExcuse: true,
  });
  expect(result.appointments.find((row) => row.id === "late")?.canExcuse).toBe(
    false,
  );
  expect(JSON.stringify(result)).not.toMatch(/reason|Private|endsAt|duration/);
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
