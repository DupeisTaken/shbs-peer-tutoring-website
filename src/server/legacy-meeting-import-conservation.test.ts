import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { recordCsv, type TransferFile } from "~/lib/record-transfer";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const headId = "legacy-meeting-conservation-head";
const originalCreatedAt = new Date("2024-09-24T06:00:00.000Z");
const originalReason = "Synthetic archive policy: retained 1.5-hour deduction";
let currentTermId: string;

// Archive IDs must be absent until Import, while satisfying real cuid inputs.
const archiveId = () => `c${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const file = (
  table: string,
  rows: Record<string, unknown>[],
): TransferFile => ({
  name: `${table}.csv`,
  text: recordCsv(Object.keys(rows[0]!), rows),
});
const staff = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: headId, name: "Synthetic conservation reviewer" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  // Recovery/audit retention is immutable; reset only the guarded disposable DB.
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
  await db.user.create({
    data: {
      id: headId,
      email: "legacy-conservation-head@example.test",
      role: "HEAD",
    },
  });
  await db.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
  await db.programFeature.createMany({
    data: [
      { key: "MEETINGS", enabled: true },
      { key: "SERVICE_HOURS", enabled: true },
      { key: "QUARTER_SYSTEM", enabled: true },
    ],
  });
  currentTermId = (
    await db.term.create({
      data: {
        schoolYear: "26-27",
        quarter: "Q2",
        name: "Synthetic current period",
        active: true,
      },
    })
  ).id;
});

afterAll(() => db.$disconnect());

async function importArchivedMeetings() {
  const tutorId = archiveId();
  const untouchedTutorId = archiveId();
  const termId = archiveId();
  const meetingIds = Array.from({ length: 4 }, archiveId);
  const deductionId = `mtgabs_${meetingIds[3]!}_${tutorId}`;
  const manualId = archiveId();
  const untouchedDeductionId = `mtgabs_${meetingIds[3]!}_${untouchedTutorId}`;
  const meetings = meetingIds.map((id, index) => ({
    id,
    title: `Synthetic archived meeting ${index + 1}`,
    date: new Date(Date.UTC(2024, 8, 2 + index * 7)).toISOString(),
    termId,
    createdAt: "2024-09-01T06:00:00.000Z",
  }));
  const attendance = [tutorId, untouchedTutorId].flatMap((ownerId) =>
    meetingIds.map((meetingId) => ({
      id: archiveId(),
      meetingId,
      tutorId: ownerId,
      status: "UNEXCUSED_ABSENT",
      reason: "Synthetic retained attendance evidence",
      excusedAt: null,
    })),
  );
  const adjustment = (
    id: string,
    ownerId: string,
    amount: number,
    reason: string,
  ) => ({
    id,
    tutorId: ownerId,
    month: "2024-09",
    schoolYear: "24-25",
    quarter: "Q1",
    type: "PUNISHMENT",
    amount,
    reason,
    createdAt: originalCreatedAt.toISOString(),
  });
  // Only data files are supplied; no provenance marker or origin metadata is injected.
  const files = [
    file("ServiceHourAdjustment", [
      adjustment(deductionId, tutorId, 1.5, originalReason),
      adjustment(manualId, tutorId, 0.75, "Synthetic unrelated manual adjustment"),
      adjustment(
        untouchedDeductionId,
        untouchedTutorId,
        0.875,
        "Synthetic other tutor's retained source policy",
      ),
    ]),
    file("MeetingAttendance", attendance),
    file("TutorMeeting", meetings),
    file("Tutor", [
      { id: tutorId, englishName: "Synthetic Archived Tutor", status: "ARCHIVED" },
      { id: untouchedTutorId, englishName: "Synthetic Untouched Tutor", status: "ARCHIVED" },
    ]),
    file("Term", [
      { id: termId, schoolYear: "24-25", quarter: "Q1", name: "Synthetic archive period", active: false },
    ]),
  ];
  const expectedSummary = [
    { table: "Term", created: 1, skipped: 0 },
    { table: "Tutor", created: 2, skipped: 0 },
    { table: "TutorMeeting", created: 4, skipped: 0 },
    { table: "MeetingAttendance", created: 8, skipped: 0 },
    { table: "ServiceHourAdjustment", created: 3, skipped: 0 },
  ];
  const preview = await staff().recordTransfer.preview({ files });
  expect(preview.summary).toEqual(expectedSummary);
  expect(await db.tutor.findUnique({ where: { id: tutorId } })).toBeNull();
  expect(await db.term.findUnique({ where: { id: termId } })).toBeNull();
  expect(await db.meetingAttendance.count()).toBe(0);
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: deductionId } })).toBeNull();
  const result = await staff().recordTransfer.import({ files, ticket: preview.ticket });
  expect(result.summary).toEqual(expectedSummary);
  expect(result.summary.reduce((sum, row) => sum + row.created, 0)).toBe(18);
  expect(result.summary.every((row) => row.skipped === 0)).toBe(true);
  expect(await db.auditLog.count({ where: { operation: "recordTransfer.import" } })).toBe(1);
  return { tutorId, untouchedTutorId, meetingIds, deductionId, manualId, untouchedDeductionId };
}

it("preserves imported historical meeting amounts and source evidence after an unrelated native attendance save", async () => {
  const archived = await importArchivedMeetings();
  const originalDeduction = await db.serviceHourAdjustment.findUniqueOrThrow({
    where: { id: archived.deductionId },
  });
  expect(originalDeduction).toMatchObject({
    tutorId: archived.tutorId,
    amount: 1.5,
    reason: originalReason,
    createdAt: originalCreatedAt,
    schoolYear: "24-25",
    quarter: "Q1",
  });
  const originalAttendance = await db.meetingAttendance.findMany({
    where: { meetingId: { in: archived.meetingIds } },
    orderBy: { id: "asc" },
  });
  const manual = await db.serviceHourAdjustment.findUniqueOrThrow({ where: { id: archived.manualId } });
  const otherTutor = await db.serviceHourAdjustment.findUniqueOrThrow({ where: { id: archived.untouchedDeductionId } });
  const roster = await db.tutor.findUniqueOrThrow({ where: { id: archived.tutorId } });
  expect(roster.status).toBe("ARCHIVED");
  // Restore current participation deliberately; importing ARCHIVED is not activation.
  await expect(staff().admin.updateTutor({
    id: roster.id,
    status: "ACTIVE",
    expectedUpdatedAt: roster.updatedAt,
  })).resolves.toMatchObject({ id: roster.id, status: "ACTIVE" });
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: archived.deductionId } })).toEqual(originalDeduction);

  const nativeMeeting = await staff().admin.createMeeting({
    title: "Synthetic unrelated current meeting",
    termId: currentTermId,
    date: new Date(Date.now() - 60_000),
  });
  await expect(staff().admin.recordMeetingAttendance({
    meetingId: nativeMeeting.id,
    entries: [{ tutorId: archived.tutorId, status: "PRESENT" }],
  })).resolves.toEqual({ ok: true });
  // Prove the real native resolver committed before inspecting archival conservation.
  expect(await db.meetingAttendance.findUnique({ where: {
    meetingId_tutorId: { meetingId: nativeMeeting.id, tutorId: archived.tutorId },
  } })).toMatchObject({ status: "PRESENT" });
  expect(await db.meetingAttendance.findMany({
    where: { meetingId: { in: archived.meetingIds } },
    orderBy: { id: "asc" },
  })).toEqual(originalAttendance);
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: archived.manualId } })).toEqual(manual);
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: archived.untouchedDeductionId } })).toEqual(otherTutor);
  // #610's conservation promise covers exact stored source values, not only a total.
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: archived.deductionId } })).toEqual(originalDeduction);
});

it("retains the native three-absence semester allowance and unrelated manual adjustments", async () => {
  const tutor = await staff().admin.createTutor({
    firstName: "Synthetic",
    lastName: "Native",
    status: "ACTIVE",
  });
  const previousQuarter = await db.term.create({
    data: { schoolYear: "26-27", quarter: "Q1", name: "Synthetic native previous quarter", active: false },
  });
  const manual = await staff().admin.createAdjustment({
    tutorId: tutor.id,
    month: "2026-11",
    type: "EXTRA",
    amount: 0.75,
    reason: "Synthetic independent manual credit",
  });
  const meetings = [];
  for (const index of [0, 1, 2, 3]) {
    const meeting = await staff().admin.createMeeting({
      title: `Synthetic native absence ${index + 1}`,
      termId: index < 3 ? previousQuarter.id : currentTermId,
      date: new Date(Date.now() - (4 - index) * 86_400_000),
    });
    meetings.push(meeting);
    await staff().admin.recordMeetingAttendance({
      meetingId: meeting.id,
      entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
    });
    expect(await db.serviceHourAdjustment.count({
      where: { tutorId: tutor.id, id: { startsWith: "mtgabs_" } },
    })).toBe(index < 3 ? 0 : 1);
  }
  expect(await db.serviceHourAdjustment.findMany({
    where: { tutorId: tutor.id, id: { startsWith: "mtgabs_" } },
  })).toEqual([
    expect.objectContaining({
      id: `mtgabs_${meetings[3]!.id}_${tutor.id}`,
      amount: 0.25,
      type: "PUNISHMENT",
      schoolYear: "26-27",
      quarter: "Q2",
    }),
  ]);
  expect(await db.serviceHourAdjustment.findUnique({ where: { id: manual.id } })).toEqual(manual);
  expect(await db.meetingAttendance.count({ where: { tutorId: tutor.id, status: "UNEXCUSED_ABSENT" } })).toBe(4);
});
