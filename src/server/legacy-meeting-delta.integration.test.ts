import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { recordCsv, type TransferFile } from "~/lib/record-transfer";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const headId = "meeting-delta-head";
const retainedDate = new Date("2024-09-24T06:00:00.000Z");
const retainedReason = "Synthetic retained meeting policy: 1.5-hour deduction";
let currentTermId: string;
let previousQuarterId: string;
let oldTermId: string;

const fixtureId = () => `c${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const deductionId = (meetingId: string, tutorId: string) =>
  `mtgabs_${meetingId}_${tutorId}`;
const archiveFile = (
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
      user: { id: headId, name: "Synthetic meeting reviewer" },
      role: "HEAD",
      tutorId: null,
      sessionVersion: 0,
      historyAccessRevision: 0,
      expires: "2099-01-01T00:00:00Z",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  // Reset only the explicitly guarded disposable database, including immutable
  // recovery/audit evidence that ordinary application deletion must preserve.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
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
      email: "meeting-delta-head@example.test",
      role: "HEAD",
    },
  });
  await db.programSettings.create({
    data: { timeZone: "Asia/Shanghai", emailNotificationsEnabled: false },
  });
  await db.programFeature.createMany({
    data: [
      { key: "MEETINGS", enabled: true },
      { key: "SERVICE_HOURS", enabled: true },
      { key: "QUARTER_SYSTEM", enabled: true },
    ],
  });
  currentTermId = fixtureId();
  previousQuarterId = fixtureId();
  oldTermId = fixtureId();
  await db.term.createMany({
    data: [
      {
        id: currentTermId,
        schoolYear: "26-27",
        quarter: "Q2",
        name: "Synthetic current quarter",
        active: true,
      },
      {
        id: previousQuarterId,
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Synthetic previous quarter",
      },
      {
        id: oldTermId,
        schoolYear: "24-25",
        quarter: "Q1",
        name: "Synthetic old semester",
      },
    ],
  });
});

afterAll(() => db.$disconnect());

const nativeTutor = (lastName = "Native") =>
  staff().admin.createTutor({
    firstName: "Synthetic",
    lastName,
    status: "ACTIVE",
  });
const nativeMeeting = (index: number, termId = currentTermId) =>
  staff().admin.createMeeting({
    title: `Synthetic native meeting ${index}`,
    termId,
    date: new Date(Date.UTC(2026, 8, index + 1, 4)),
  });
const recordedAttendance = () =>
  db.meetingAttendance.findMany({ orderBy: { id: "asc" } });
const adjustments = () =>
  db.serviceHourAdjustment.findMany({ orderBy: { id: "asc" } });

async function recordAbsences(tutorIds: string[], count = 5) {
  const meetings = [];
  for (let index = 0; index < count; index++) {
    const meeting = await nativeMeeting(
      index,
      index < 3 ? previousQuarterId : currentTermId,
    );
    meetings.push(meeting);
    await staff().admin.recordMeetingAttendance({
      meetingId: meeting.id,
      entries: tutorIds.map((tutorId) => ({
        tutorId,
        status: "UNEXCUSED_ABSENT" as const,
      })),
    });
  }
  return meetings;
}

async function seedUnmarkedOldHistory(tutorId: string) {
  // This deliberately models pretracking data. Direct fixture insertion does
  // not assert whether a real historical row was imported or natively created.
  const meetingIds = Array.from({ length: 4 }, fixtureId);
  await db.tutorMeeting.createMany({
    data: meetingIds.map((id, index) => ({
      id,
      title: `Synthetic unclassified old meeting ${index}`,
      date: new Date(Date.UTC(2024, 8, 2 + index * 7, 4)),
      termId: oldTermId,
    })),
  });
  await db.meetingAttendance.createMany({
    data: meetingIds.map((meetingId) => ({
      meetingId,
      tutorId,
      status: "UNEXCUSED_ABSENT" as const,
      reason: "Synthetic pretracking attendance evidence",
    })),
  });
  const retained = await db.serviceHourAdjustment.create({
    data: {
      id: deductionId(meetingIds[3]!, tutorId),
      tutorId,
      month: "2024-09",
      schoolYear: "24-25",
      quarter: "Q1",
      type: "PUNISHMENT",
      amount: 1.5,
      reason: retainedReason,
      createdAt: retainedDate,
    },
  });
  expect(await db.importedRecordProvenance.count()).toBe(0);
  return { meetingIds, retained };
}

async function importRecords(files: TransferFile[]) {
  const preview = await staff().recordTransfer.preview({ files });
  const result = await staff().recordTransfer.import({
    files,
    ticket: preview.ticket,
  });
  expect(result.summary).toEqual(preview.summary);
  return result.summary;
}

async function reserveDeduction(
  meetingId: string,
  tutorId: string,
  present: boolean,
) {
  const id = deductionId(meetingId, tutorId);
  // Positive archive cases acquire their marker through the real committed
  // importer, never by injecting provenance into the mutation under test.
  await importRecords([
    archiveFile("ServiceHourAdjustment", [
      {
        id,
        tutorId,
        month: "2026-09",
        schoolYear: "26-27",
        quarter: "Q2",
        type: "PUNISHMENT",
        amount: 1.5,
        reason: retainedReason,
        createdAt: retainedDate.toISOString(),
      },
    ]),
  ]);
  expect(
    await db.importedRecordProvenance.findUnique({
      where: {
        entity_recordId: { entity: "ServiceHourAdjustment", recordId: id },
      },
    }),
  ).not.toBeNull();
  if (!present) {
    // Model a missing historical source whose durable logical key remains
    // reserved. This is fixture damage, not an authorized archive deletion.
    await db.serviceHourAdjustment.delete({ where: { id } });
  }
  return id;
}

it.each(["current", "same-semester"] as const)(
  "[LMA01.%s] preserves unmarked pretracking amount, reason and date on a neutral PRESENT save",
  async (scope) => {
    const tutor = await nativeTutor();
    const old = await seedUnmarkedOldHistory(tutor.id);
    const manual = await staff().admin.createAdjustment({
      tutorId: tutor.id,
      month: "2026-09",
      type: "EXTRA",
      amount: 0.75,
      reason: "Synthetic independent manual credit",
    });
    const oldAttendance = await recordedAttendance();
    const meeting =
      scope === "current"
        ? await nativeMeeting(8)
        : await staff().admin.createMeeting({
            title: "Synthetic neutral meeting in the recorded old semester",
            termId: oldTermId,
            date: new Date("2024-10-01T04:00:00.000Z"),
          });
    await expect(
      staff().admin.recordMeetingAttendance({
        meetingId: meeting.id,
        entries: [{ tutorId: tutor.id, status: "PRESENT" }],
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      await db.meetingAttendance.findUnique({
        where: {
          meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id },
        },
      }),
    ).toMatchObject({ status: "PRESENT" });
    expect(
      await db.meetingAttendance.findMany({
        where: { meetingId: { in: old.meetingIds } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(oldAttendance);
    expect(await adjustments()).toEqual(
      [old.retained, manual].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await db.importedRecordProvenance.count()).toBe(0);
  },
);

it("[LMA02] does not repair a missing unchanged target or normalize a retained fifth deduction", async () => {
  const tutor = await nativeTutor();
  const meetings = await recordAbsences([tutor.id]);
  const fourthId = deductionId(meetings[3]!.id, tutor.id);
  const fifthId = deductionId(meetings[4]!.id, tutor.id);
  await db.serviceHourAdjustment.delete({ where: { id: fourthId } });
  const fifth = await db.serviceHourAdjustment.update({
    where: { id: fifthId },
    data: { amount: 1.5, reason: retainedReason, createdAt: retainedDate },
  });
  const meeting = await nativeMeeting(9);
  await staff().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [{ tutorId: tutor.id, status: "PRESENT" }],
  });
  expect(await adjustments()).toEqual([fifth]);
  expect(
    await db.serviceHourAdjustment.findUnique({ where: { id: fourthId } }),
  ).toBeNull();
});

it.each(["correction", "deletion"] as const)(
  "[LMA03.%s] moves the native threshold across Q1/Q2 without rewriting its unchanged fifth deduction",
  async (operation) => {
    const tutor = await nativeTutor();
    const meetings = await recordAbsences([tutor.id]);
    const fourthId = deductionId(meetings[3]!.id, tutor.id);
    const fifth = await db.serviceHourAdjustment.update({
      where: { id: deductionId(meetings[4]!.id, tutor.id) },
      data: { amount: 0.875, reason: retainedReason, createdAt: retainedDate },
    });
    if (operation === "correction") {
      await staff().admin.recordMeetingAttendance({
        meetingId: meetings[0]!.id,
        entries: [{ tutorId: tutor.id, status: "EXCUSED_ABSENT" }],
      });
      expect(
        await db.meetingAttendance.findUnique({
          where: {
            meetingId_tutorId: {
              meetingId: meetings[0]!.id,
              tutorId: tutor.id,
            },
          },
        }),
      ).toMatchObject({ status: "EXCUSED_ABSENT" });
    } else {
      await staff().admin.deleteMeeting({ id: meetings[0]!.id });
      expect(
        await db.meetingAttendance.count({
          where: { meetingId: meetings[0]!.id },
        }),
      ).toBe(0);
    }
    expect(await adjustments()).toEqual([fifth]);
    expect(
      await db.serviceHourAdjustment.findUnique({ where: { id: fourthId } }),
    ).toBeNull();
  },
);

it("[LMA04] treats a duplicate tutor P→UA→P batch as one neutral logical change", async () => {
  const tutor = await nativeTutor();
  await recordAbsences([tutor.id], 4);
  const meeting = await nativeMeeting(10);
  await staff().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [{ tutorId: tutor.id, status: "PRESENT" }],
  });
  const before = await adjustments();
  await staff().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [
      { tutorId: tutor.id, status: "PRESENT" },
      { tutorId: tutor.id, status: "UNEXCUSED_ABSENT" },
      { tutorId: tutor.id, status: "PRESENT" },
    ],
  });
  expect(await adjustments()).toEqual(before);
  expect(
    await db.meetingAttendance.findUnique({
      where: {
        meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id },
      },
    }),
  ).toMatchObject({ status: "PRESENT" });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { operation: "admin.recordMeetingAttendance" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  expect(JSON.stringify(audit.details)).not.toContain(
    '"entity":"ServiceHourAdjustment"',
  );
});

it("[LMA05] captures both tutors' old semester state before a parent deletion cascades", async () => {
  const tutors = [await nativeTutor("Alpha"), await nativeTutor("Beta")];
  const meetings = await recordAbsences(tutors.map((tutor) => tutor.id));
  const fifthRows = [];
  for (const tutor of tutors) {
    fifthRows.push(
      await db.serviceHourAdjustment.update({
        where: { id: deductionId(meetings[4]!.id, tutor.id) },
        data: { reason: retainedReason, createdAt: retainedDate },
      }),
    );
  }
  await staff().admin.deleteMeeting({ id: meetings[0]!.id });
  expect(await db.meetingAttendance.count()).toBe(8);
  expect(await adjustments()).toEqual(
    fifthRows.sort((a, b) => a.id.localeCompare(b.id)),
  );
});

it("[LMA06] excludes committed archive absences from the native three-absence allowance", async () => {
  const tutor = await nativeTutor();
  const meetingIds = Array.from({ length: 4 }, fixtureId);
  await importRecords([
    archiveFile(
      "TutorMeeting",
      meetingIds.map((id, index) => ({
        id,
        title: `Synthetic archive allowance meeting ${index}`,
        date: new Date(Date.UTC(2026, 7, index + 1, 4)).toISOString(),
        termId: currentTermId,
      })),
    ),
    archiveFile(
      "MeetingAttendance",
      meetingIds.map((meetingId) => ({
        id: fixtureId(),
        meetingId,
        tutorId: tutor.id,
        status: "UNEXCUSED_ABSENT",
      })),
    ),
  ]);
  await recordAbsences([tutor.id], 3);
  expect(await adjustments()).toEqual([]);
  const fourth = await nativeMeeting(12);
  await staff().admin.recordMeetingAttendance({
    meetingId: fourth.id,
    entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
  });
  expect(await adjustments()).toEqual([
    expect.objectContaining({
      id: deductionId(fourth.id, tutor.id),
      amount: 0.25,
      quarter: "Q2",
    }),
  ]);
});

it.each([
  { change: "create", present: true },
  { change: "create", present: false },
  { change: "remove", present: true },
  { change: "remove", present: false },
] as const)(
  "[LMA07.$change.$present] refuses an affected archive-reserved deduction key atomically",
  async ({ change, present }) => {
    const tutor = await nativeTutor();
    const meetings = await recordAbsences([tutor.id], 3);
    const fourth = await nativeMeeting(13);
    meetings.push(fourth);
    await staff().admin.recordMeetingAttendance({
      meetingId: fourth.id,
      entries: [{ tutorId: tutor.id, status: "PRESENT" }],
    });
    if (change === "remove") {
      await staff().admin.recordMeetingAttendance({
        meetingId: fourth.id,
        entries: [{ tutorId: tutor.id, status: "UNEXCUSED_ABSENT" }],
      });
      // Replace this fixture's native target through a real archive insertion;
      // importing an equal existing row must never manufacture provenance.
      await db.serviceHourAdjustment.delete({
        where: { id: deductionId(fourth.id, tutor.id) },
      });
    }
    await reserveDeduction(fourth.id, tutor.id, present);
    const beforeAttendance = await recordedAttendance();
    const beforeAdjustments = await adjustments();
    await expect(
      staff().admin.recordMeetingAttendance({
        meetingId: change === "create" ? fourth.id : meetings[0]!.id,
        entries: [
          {
            tutorId: tutor.id,
            status: change === "create" ? "UNEXCUSED_ABSENT" : "EXCUSED_ABSENT",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await recordedAttendance()).toEqual(beforeAttendance);
    expect(await adjustments()).toEqual(beforeAdjustments);
  },
);

it("[LMA08] rolls back an earlier tutor's new effect when a later tutor has a reserved-key conflict", async () => {
  const tutors = [await nativeTutor("Alpha"), await nativeTutor("Beta")].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  await recordAbsences(
    tutors.map((tutor) => tutor.id),
    3,
  );
  const meeting = await nativeMeeting(14);
  await staff().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: tutors.map((tutor) => ({ tutorId: tutor.id, status: "PRESENT" })),
  });
  await reserveDeduction(meeting.id, tutors[1]!.id, false);
  const beforeAttendance = await recordedAttendance();
  const beforeAdjustments = await adjustments();
  await expect(
    staff().admin.recordMeetingAttendance({
      meetingId: meeting.id,
      entries: tutors.map((tutor) => ({
        tutorId: tutor.id,
        status: "UNEXCUSED_ABSENT",
      })),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await recordedAttendance()).toEqual(beforeAttendance);
  expect(await adjustments()).toEqual(beforeAdjustments);
});

it("[LMA09] conserves unmarked old evidence through real self-excuse creation and cancellation", async () => {
  const tutor = await nativeTutor();
  const old = await seedUnmarkedOldHistory(tutor.id);
  const user = await db.user.create({
    data: {
      email: "meeting-delta-tutor@example.test",
      role: "TUTOR",
      tutorId: tutor.id,
      sessionVersion: 0,
      historyAccessRevision: 0,
    },
  });
  const api = createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: user.id, name: "Synthetic native tutor" },
      role: "TUTOR",
      tutorId: tutor.id,
      expires: "2099-01-01T00:00:00Z",
    },
  }).tutor;
  const meeting = await staff().admin.createMeeting({
    title: "Synthetic upcoming self-excuse",
    termId: currentTermId,
    date: new Date(Date.now() + 2 * 86_400_000),
  });
  await api.excuseMeeting({ meetingId: meeting.id, reason: "Synthetic class" });
  expect(
    await db.serviceHourAdjustment.findUnique({
      where: { id: old.retained.id },
    }),
  ).toEqual(old.retained);
  expect(
    await db.meetingAttendance.findUnique({
      where: {
        meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id },
      },
    }),
  ).toMatchObject({ status: "EXCUSED_ABSENT", reason: "Synthetic class" });
  await api.excuseMeeting({
    meetingId: meeting.id,
    reason: "Synthetic revised class",
  });
  expect(
    await db.meetingAttendance.findUnique({
      where: {
        meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id },
      },
    }),
  ).toMatchObject({
    status: "EXCUSED_ABSENT",
    reason: "Synthetic revised class",
  });
  expect(await adjustments()).toEqual([old.retained]);
  await api.cancelMeetingExcuse({ meetingId: meeting.id });
  expect(
    await db.meetingAttendance.findUnique({
      where: {
        meetingId_tutorId: { meetingId: meeting.id, tutorId: tutor.id },
      },
    }),
  ).toBeNull();
  expect(await adjustments()).toEqual([old.retained]);
});

it("[LMA10] preserves exact source values after real 18-row Preview/Import, activation and native PRESENT", async () => {
  // This case imports its own old term; remove only the unused shared fixture
  // so the real unique school-year/quarter admission remains enforced.
  await db.term.delete({ where: { id: oldTermId } });
  const tutorId = fixtureId();
  const otherTutorId = fixtureId();
  const termId = fixtureId();
  const meetingIds = Array.from({ length: 4 }, fixtureId);
  const originalId = deductionId(meetingIds[3]!, tutorId);
  const manualId = fixtureId();
  const otherId = deductionId(meetingIds[3]!, otherTutorId);
  const archiveAdjustment = (id: string, ownerId: string, amount: number) => ({
    id,
    tutorId: ownerId,
    month: "2024-09",
    schoolYear: "24-25",
    quarter: "Q1",
    type: "PUNISHMENT",
    amount,
    reason: retainedReason,
    createdAt: retainedDate.toISOString(),
  });
  const files = [
    archiveFile("ServiceHourAdjustment", [
      archiveAdjustment(originalId, tutorId, 1.5),
      archiveAdjustment(manualId, tutorId, 0.75),
      archiveAdjustment(otherId, otherTutorId, 0.875),
    ]),
    archiveFile(
      "MeetingAttendance",
      [tutorId, otherTutorId].flatMap((ownerId) =>
        meetingIds.map((meetingId) => ({
          id: fixtureId(),
          meetingId,
          tutorId: ownerId,
          status: "UNEXCUSED_ABSENT",
          reason: "Synthetic retained archive attendance",
        })),
      ),
    ),
    archiveFile(
      "TutorMeeting",
      meetingIds.map((id, index) => ({
        id,
        title: `Synthetic imported meeting ${index}`,
        date: new Date(Date.UTC(2024, 8, 2 + index * 7, 4)).toISOString(),
        termId,
      })),
    ),
    archiveFile("Tutor", [
      {
        id: tutorId,
        englishName: "Synthetic Archive Tutor",
        status: "ARCHIVED",
      },
      {
        id: otherTutorId,
        englishName: "Synthetic Untouched Tutor",
        status: "ARCHIVED",
      },
    ]),
    archiveFile("Term", [
      {
        id: termId,
        schoolYear: "24-25",
        quarter: "Q1",
        name: "Synthetic import quarter",
        active: false,
      },
    ]),
  ];
  const preview = await staff().recordTransfer.preview({ files });
  expect(preview.summary).toEqual([
    { table: "Term", created: 1, skipped: 0 },
    { table: "Tutor", created: 2, skipped: 0 },
    { table: "TutorMeeting", created: 4, skipped: 0 },
    { table: "MeetingAttendance", created: 8, skipped: 0 },
    { table: "ServiceHourAdjustment", created: 3, skipped: 0 },
  ]);
  expect(await db.tutor.findUnique({ where: { id: tutorId } })).toBeNull();
  expect(await db.meetingAttendance.count()).toBe(0);
  expect(await db.importedRecordProvenance.count()).toBe(0);
  const imported = await staff().recordTransfer.import({
    files,
    ticket: preview.ticket,
  });
  expect(imported.summary).toEqual(preview.summary);
  expect(imported.summary.reduce((total, row) => total + row.created, 0)).toBe(
    18,
  );
  expect(
    await db.auditLog.count({ where: { operation: "recordTransfer.import" } }),
  ).toBe(1);
  const beforeAdjustments = await adjustments();
  const beforeAttendance = await recordedAttendance();
  expect(beforeAdjustments.find((row) => row.id === originalId)).toMatchObject({
    amount: 1.5,
    reason: retainedReason,
    createdAt: retainedDate,
  });
  const tutor = await db.tutor.findUniqueOrThrow({ where: { id: tutorId } });
  await staff().admin.updateTutor({
    id: tutor.id,
    status: "ACTIVE",
    expectedUpdatedAt: tutor.updatedAt,
  });
  const meeting = await nativeMeeting(15);
  await staff().admin.recordMeetingAttendance({
    meetingId: meeting.id,
    entries: [{ tutorId, status: "PRESENT" }],
  });
  expect(await adjustments()).toEqual(beforeAdjustments);
  expect(
    await db.meetingAttendance.findMany({
      where: { meetingId: { in: meetingIds } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(beforeAttendance);
  expect(
    await db.meetingAttendance.findUnique({
      where: { meetingId_tutorId: { meetingId: meeting.id, tutorId } },
    }),
  ).toMatchObject({ status: "PRESENT" });
});

it.each(["parent", "attendance"] as const)(
  "[LMA11.%s] independently preserves the imported source guard on neutral saves and deletion",
  async (source) => {
    const tutor = await staff().admin.createTutor({
      firstName: "Synthetic",
      lastName: "Archived source guard",
      status: "ARCHIVED",
    });
    let meetingId: string;
    if (source === "parent") {
      meetingId = fixtureId();
      await importRecords([
        archiveFile("TutorMeeting", [
          {
            id: meetingId,
            title: "Synthetic imported parent only",
            termId: oldTermId,
            date: "2024-10-01T04:00:00.000Z",
          },
        ]),
      ]);
    } else {
      const parent = await staff().admin.createMeeting({
        title: "Synthetic unmarked parent",
        termId: oldTermId,
        date: new Date("2024-10-01T04:00:00.000Z"),
      });
      meetingId = parent.id;
      await importRecords([
        archiveFile("MeetingAttendance", [
          {
            id: fixtureId(),
            meetingId,
            tutorId: tutor.id,
            status: "PRESENT",
          },
        ]),
      ]);
    }
    const markers = await db.importedRecordProvenance.findMany({
      select: { entity: true },
    });
    expect(markers).toEqual([
      {
        entity: source === "parent" ? "TutorMeeting" : "MeetingAttendance",
      },
    ]);
    const roster = await db.tutor.findUniqueOrThrow({
      where: { id: tutor.id },
    });
    await staff().admin.updateTutor({
      id: tutor.id,
      status: "ACTIVE",
      expectedUpdatedAt: roster.updatedAt,
    });
    const beforeAttendance = await recordedAttendance();
    const beforeAdjustments = await adjustments();
    await expect(
      staff().admin.recordMeetingAttendance({
        meetingId,
        entries: [{ tutorId: tutor.id, status: "PRESENT" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      staff().admin.deleteMeeting({ id: meetingId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.tutorMeeting.findUnique({ where: { id: meetingId } }),
    ).not.toBeNull();
    expect(await recordedAttendance()).toEqual(beforeAttendance);
    expect(await adjustments()).toEqual(beforeAdjustments);
  },
);
