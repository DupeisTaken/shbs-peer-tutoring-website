import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  captureMeetingHours,
  reconcileMeetingHours,
} from "~/server/meeting-hours";

const past = new Date(Date.now() - 86400_000);
const future = new Date(Date.now() + 86400_000);
const session = (role: "ADMIN" | "VIEWER" | "TUTOR" = "ADMIN"): Session => ({
  user: { id: role.toLowerCase(), name: role },
  role,
  tutorId: role === "TUTOR" ? "mine" : null,
  expires: "2099-01-01",
});
const caller = (role?: "ADMIN" | "VIEWER" | "TUTOR") =>
  createCaller({ db, session: session(role), headers: new Headers() });

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
  await db.term.createMany({
    data: [
      { id: "old", schoolYear: "25-26", quarter: "Q1", name: "Old" },
      { id: "q1", schoolYear: "26-27", quarter: "Q1", name: "Q1" },
      {
        id: "q2",
        schoolYear: "26-27",
        quarter: "Q2",
        name: "Q2",
        active: true,
      },
    ],
  });
  await db.tutor.createMany({
    data: [
      { id: "mine", englishName: "My Tutor", status: "ACTIVE" },
      { id: "other", englishName: "Other Tutor", status: "ACTIVE" },
    ],
  });
  await db.user.createMany({
    data: [
      { id: "admin", email: "admin@meetings.example.test", role: "ADMIN" },
      { id: "viewer", email: "viewer@meetings.example.test", role: "VIEWER" },
      {
        id: "tutor",
        email: "tutor@meetings.example.test",
        role: "TUTOR",
        tutorId: "mine",
      },
    ],
  });
  await db.tutorMeeting.createMany({
    data: [
      {
        id: "current-past",
        title: "Current completed",
        termId: "q2",
        date: past,
      },
      {
        id: "current-future",
        title: "Current upcoming",
        termId: "q2",
        date: future,
      },
      { id: "history", title: "My recorded history", termId: "q1", date: past },
      {
        id: "other-history",
        title: "Someone else's history",
        termId: "old",
        date: past,
      },
      { id: "outside", title: "Upcoming old term", termId: "q1", date: future },
      { id: "unassigned", title: "Legacy personal record", date: past },
      { id: "unassigned-future", title: "Unassigned upcoming", date: future },
    ],
  });
  await db.meetingAttendance.createMany({
    data: [
      {
        meetingId: "history",
        tutorId: "mine",
        status: "PRESENT",
        reason: "Own note",
      },
      {
        meetingId: "history",
        tutorId: "other",
        status: "EXCUSED_ABSENT",
        reason: "Private other note",
      },
      { meetingId: "other-history", tutorId: "other", status: "PRESENT" },
      { meetingId: "unassigned", tutorId: "mine", status: "EXEMPT" },
    ],
  });
});
afterAll(() => db.$disconnect());

it("scopes staff current meetings by recorded term, including completed dates", async () => {
  const rows = await caller().admin.meetings({ period: "current" });
  expect(rows.map((row) => row.id).sort()).toEqual([
    "current-future",
    "current-past",
  ]);
  expect((await caller().admin.meetingPeriods()).current?.label).toBe(
    "2026–27 Q2",
  );
  expect(
    (await caller().admin.meetings({ period: "25-26:Q1" })).map(
      (row) => row.id,
    ),
  ).toEqual(["other-history"]);
});

it("groups semester mode across recorded Q1/Q2 and ignores staged switches", async () => {
  await db.programFeature.create({
    data: { key: "QUARTER_SYSTEM", enabled: true, pendingEnabled: false },
  });
  expect((await caller().admin.meetingPeriods()).current?.label).toBe(
    "2026–27 Q2",
  );
  await db.programFeature.update({
    where: { key: "QUARTER_SYSTEM" },
    data: { enabled: false },
  });
  const catalog = await caller().admin.meetingPeriods();
  expect(catalog.quarters).toBe(false);
  expect(catalog.current).toEqual({ key: "26-27:S1", label: "2026–27 S1" });
  expect(catalog.history.map((group) => group.key)).toEqual([
    "25-26:S1",
    "unassigned",
  ]);
  expect(
    (await caller().admin.meetings({ period: "current" }))
      .map((row) => row.id)
      .sort(),
  ).toEqual(["current-future", "current-past", "history", "outside"]);
  expect(catalog.outsideUpcoming).toBe(1);
  // Explicit recorded quarter keys keep their scope despite regrouping.
  expect(
    (await caller().admin.meetings({ period: "26-27:Q1" }))
      .map((row) => row.id)
      .sort(),
  ).toEqual(["history", "outside"]);
  await db.programFeature.update({
    where: { key: "QUARTER_SYSTEM" },
    data: { enabled: true },
  });
  const restored = await caller().admin.meetingPeriods();
  expect(restored.quarters).toBe(true);
  expect(restored.current?.key).toBe("26-27:Q2");
  expect(restored.history.map((group) => group.key)).toContain("26-27:Q1");
  expect(restored.outsideUpcoming).toBe(2);
});

it("handles Q2 evidence with active Q1 across applied mode changes without broadening tutor history", async () => {
  await db.term.updateMany({ data: { active: false } });
  await db.term.update({ where: { id: "q1" }, data: { active: true } });
  await db.programFeature.create({
    data: { key: "QUARTER_SYSTEM", enabled: false, pendingEnabled: true },
  });
  const api = caller("TUTOR").tutor;
  expect((await api.meetingPeriods()).current?.key).toBe("26-27:S1");
  const semesterRows = await api.meetingRecords({ period: "26-27:S1" });
  expect(semesterRows.map((row) => row.id).sort()).toEqual([
    "current-future",
    "current-past",
    "history",
    "outside",
  ]);
  // A retained quarter within the applied current semester remains actionable.
  expect(
    (await api.meetingRecords({ period: "26-27:Q1" })).find(
      (row) => row.id === "outside",
    )?.canExcuse,
  ).toBe(true);
  await db.programFeature.update({
    where: { key: "QUARTER_SYSTEM" },
    data: { enabled: true, pendingEnabled: null },
  });
  const catalog = await api.meetingPeriods();
  expect(catalog.current?.key).toBe("26-27:Q1");
  expect(catalog.history.find((group) => group.key === "26-27:Q2")?.count).toBe(
    1,
  );
  // The retained semester contains current Q1 plus eligible Q2 evidence only.
  const retained = await api.meetingRecords({ period: "26-27:S1" });
  expect(retained.map((row) => row.id).sort()).toEqual([
    "current-future",
    "history",
    "outside",
  ]);
  expect(retained.find((row) => row.id === "current-future")?.canExcuse).toBe(
    true,
  );
  expect(JSON.stringify(retained)).not.toContain("Private other note");
  expect(
    (await api.meetingRecords({ period: "26-27:Q2" })).map((row) => row.id),
  ).toEqual(["current-future"]);
});

it("binds outside obligations to the displayed recorded group across Q/S toggles and no-active catalogs", async () => {
  const api = caller("TUTOR").tutor;
  const bound = { period: "upcomingOutside", outsideCurrent: "26-27:Q2" };
  const ids = async () =>
    (await api.meetingRecords(bound)).map((row) => row.id).sort();
  expect(await ids()).toEqual(["outside", "unassigned-future"]);
  await db.programFeature.create({
    data: { key: "QUARTER_SYSTEM", enabled: false },
  });
  expect(await ids()).toEqual(["outside", "unassigned-future"]);
  expect(
    (await caller().admin.meetings(bound)).map((row) => row.id).sort(),
  ).toEqual(["outside", "unassigned-future"]);
  expect(
    (await api.meetingRecords({ period: "upcomingOutside" })).map(
      (row) => row.id,
    ),
  ).toEqual(["unassigned-future"]);
  // Explicit null preserves an unconfigured catalog's all-upcoming overview.
  expect(
    (
      await api.meetingRecords({
        period: "upcomingOutside",
        outsideCurrent: null,
      })
    )
      .map((row) => row.id)
      .sort(),
  ).toEqual(["current-future", "outside", "unassigned-future"]);
  await db.programFeature.update({
    where: { key: "QUARTER_SYSTEM" },
    data: { enabled: true },
  });
  expect(await ids()).toEqual(["outside", "unassigned-future"]);
});

it("keeps unassigned and old-term upcoming obligations visible across rollover", async () => {
  const api = caller("TUTOR").tutor;
  const before = await api.meetingPeriods();
  expect(before.outsideUpcoming).toBe(2);
  expect(
    (await api.meetingRecords({ period: "upcomingOutside" }))
      .map((row) => row.id)
      .sort(),
  ).toEqual(["outside", "unassigned-future"]);
  await db.term.update({ where: { id: "q2" }, data: { active: false } });
  await db.term.create({
    data: { schoolYear: "26-27", quarter: "Q3", name: "Q3", active: true },
  });
  expect(await api.meetingRecords({ period: "current" })).toEqual([]);
  expect((await api.meetingPeriods()).outsideUpcoming).toBe(3);
});

it("retains personal history for an empty or missing active period without exposing others' evidence", async () => {
  await db.term.updateMany({ data: { active: false } });
  const api = caller("TUTOR").tutor;
  const catalog = await api.meetingPeriods();
  expect(catalog.current).toBeNull();
  expect(catalog.history.map((group) => group.key)).not.toContain("25-26:Q1");
  expect(await api.meetingRecords({ period: "25-26:Q1" })).toEqual([]);
  const rows = await api.meetingRecords({ period: "26-27:Q1" });
  expect(rows.find((row) => row.id === "history")).toMatchObject({
    status: "PRESENT",
    reason: "Own note",
    canExcuse: false,
  });
  expect(JSON.stringify(rows)).not.toContain("Private other note");
  expect(rows.every((row) => !row.canExcuse)).toBe(true);
  expect(
    (await api.meetingRecords({ period: "unassigned" })).find(
      (row) => row.id === "unassigned",
    )?.status,
  ).toBe("EXEMPT");
});

it("keeps task counts upcoming-only and does not infer an absence from a missing row", async () => {
  const api = caller("TUTOR").tutor;
  const current = await api.meetingRecords({ period: "current" });
  expect(await api.meetingRecords({ period: "26-27:Q2" })).toEqual(current);
  expect(current.find((row) => row.id === "current-past")).toMatchObject({
    status: null,
    upcoming: false,
    canExcuse: false,
  });
  expect(current.find((row) => row.id === "current-future")?.canExcuse).toBe(
    true,
  );
  expect((await api.myMeetings()).map((row) => row.id).sort()).toEqual([
    "current-future",
    "outside",
    "unassigned-future",
  ]);
  await db.tutorMeeting.update({
    where: { id: "current-future" },
    data: { date: new Date(Date.now() + 59 * 60_000) },
  });
  expect(
    (await api.meetingRecords({ period: "current" })).find(
      (row) => row.id === "current-future",
    )?.canExcuse,
  ).toBe(false);
});

it("keeps staff attendance read-only in both personal meeting reads while retaining self-excuse and cutoff rules", async () => {
  const rows = [
    {
      id: "staff-present",
      status: "PRESENT",
      marker: past,
      excused: false,
      canExcuse: false,
    },
    {
      id: "staff-exempt",
      status: "EXEMPT",
      marker: past,
      excused: false,
      canExcuse: false,
    },
    {
      id: "staff-excused",
      status: "EXCUSED_ABSENT",
      marker: null,
      excused: false,
      canExcuse: false,
    },
    {
      id: "legacy-staff-excused",
      status: "EXCUSED_ABSENT",
      marker: past,
      excused: false,
      canExcuse: false,
    },
    {
      id: "staff-unexcused",
      status: "UNEXCUSED_ABSENT",
      marker: past,
      excused: false,
      canExcuse: false,
    },
    {
      id: "self-excused",
      status: "EXCUSED_ABSENT",
      marker: past,
      excused: true,
      canExcuse: true,
    },
    {
      id: "self-inside-cutoff",
      status: "EXCUSED_ABSENT",
      marker: past,
      excused: true,
      canExcuse: false,
    },
    {
      id: "unrecorded",
      status: null,
      marker: null,
      excused: false,
      canExcuse: true,
    },
  ] as const;
  await db.tutorMeeting.createMany({
    data: rows.map((row) => ({
      id: row.id,
      title: `Synthetic ${row.id}`,
      termId: "q2",
      date:
        row.id === "self-inside-cutoff"
          ? new Date(Date.now() + 45 * 60_000)
          : future,
    })),
  });
  for (const row of rows) {
    if (row.status) {
      const attendance = await db.meetingAttendance.create({
        data: {
          meetingId: row.id,
          tutorId: "mine",
          status: row.status,
          excusedAt: row.marker,
        },
      });
      if (row.id === "legacy-staff-excused")
        await db.auditLog.create({
          data: {
            operation: "admin.recordMeetingAttendance",
            action: "Synthetic legacy staff review",
            entity: "MeetingAttendance",
            details: {
              outcome: "APPLIED",
              changes: [
                {
                  entity: "MeetingAttendance",
                  after: [{ id: attendance.id, excusedAt: past.toISOString() }],
                },
              ],
            },
          },
        });
    }
  }
  // Another tutor's recorded attendance never owns this tutor's unrecorded row.
  await db.meetingAttendance.create({
    data: {
      meetingId: "unrecorded",
      tutorId: "other",
      status: "PRESENT",
      reason: "Private other evidence",
    },
  });
  const api = caller("TUTOR").tutor;
  const records = await api.meetingRecords({ period: "current" });
  const upcoming = await api.myMeetings();
  for (const { id, status, excused, canExcuse } of rows) {
    for (const projection of [records, upcoming]) {
      expect(
        projection.find((row) => row.id === id),
        id,
      ).toMatchObject({ status, excused, canExcuse });
    }
  }
  expect(JSON.stringify([records, upcoming])).not.toContain(
    "Private other evidence",
  );
});

it("preserves viewer masking and denies tutor access to staff period reads", async () => {
  expect((await caller("VIEWER").admin.meetingPeriods()).current?.key).toBe(
    "26-27:Q2",
  );
  const rows = await caller("VIEWER").admin.meetings({ period: "26-27:Q1" });
  expect(
    rows
      .find((row) => row.id === "history")
      ?.attendances.every((row) => row.reason === null),
  ).toBe(true);
  await expect(caller("TUTOR").admin.meetingPeriods()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(caller("VIEWER").tutor.meetingPeriods()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller().admin.meetings({ period: "invalid" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("keeps absence deductions semester-wide independently of the visible quarter", async () => {
  await db.$transaction(async (tx) => {
    const before = await captureMeetingHours(tx, "mine");
    for (let i = 0; i < 4; i++) {
      const meeting = await tx.tutorMeeting.create({
        data: {
          title: "Recorded absence",
          termId: i < 3 ? "q1" : "q2",
          date: new Date(past.getTime() + i * 1000),
        },
      });
      await tx.meetingAttendance.create({
        data: {
          meetingId: meeting.id,
          tutorId: "mine",
          status: "UNEXCUSED_ABSENT",
        },
      });
    }
    await reconcileMeetingHours(tx, "mine", before);
  });
  await caller().admin.meetings({ period: "current" });
  expect(
    await db.serviceHourAdjustment.findMany({
      where: { tutorId: "mine" },
      select: { amount: true, quarter: true },
    }),
  ).toEqual([{ amount: 0.25, quarter: "Q2" }]);
});

it("does not rewrite or delete imported meeting evidence through native management actions", async () => {
  const meeting = await db.tutorMeeting.create({
    data: { title: "Archived meeting", termId: "old", date: past },
  });
  const attendance = await db.meetingAttendance.create({
    data: {
      meetingId: meeting.id,
      tutorId: "mine",
      status: "UNEXCUSED_ABSENT",
    },
  });
  await db.importedRecordProvenance.createMany({
    data: [
      { entity: "TutorMeeting", recordId: meeting.id },
      { entity: "MeetingAttendance", recordId: attendance.id },
    ],
  });
  await expect(
    caller().admin.recordMeetingAttendance({
      meetingId: meeting.id,
      entries: [{ tutorId: "mine", status: "PRESENT" }],
    }),
  ).rejects.toThrow(/imported historical evidence/);
  await expect(
    caller().admin.deleteMeeting({ id: meeting.id }),
  ).rejects.toThrow(/imported historical evidence/);
  expect(
    (
      await db.meetingAttendance.findUniqueOrThrow({
        where: { id: attendance.id },
      })
    ).status,
  ).toBe("UNEXCUSED_ABSENT");
  expect(
    await db.tutorMeeting.findUnique({ where: { id: meeting.id } }),
  ).not.toBeNull();
});
