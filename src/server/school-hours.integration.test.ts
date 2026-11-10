import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  Prisma,
  PrismaClient,
  type SchoolHoursSchedule,
} from "../../generated/prisma";
import { db } from "./db";
import { utcDatabaseUrl } from "./database-url";
import { schedulingPgOptions } from "./database-options";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import type { DomainDb } from "./transactions";
import {
  changeSchoolHoursLink,
  generateSchoolHours,
  getSchoolHoursReport,
  previewSchoolHours,
  retrySchoolHoursReport,
  reviewSchoolHoursBaseline,
  saveSchoolHoursSettings,
  schoolHoursBaselinePreview,
  schoolHoursCsv,
  sweepSchoolHours,
} from "./school-hours";
import { issueSchoolHoursToken } from "./school-hours-link";
import { retrieveSchoolHoursReport } from "./school-hours-public";
import {
  schoolHoursSnapshotSchema,
  type SchoolHoursSnapshot,
} from "./school-hours-input";

vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: () => true,
}));
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "school-hours-domain-";
const id = (value: string) => prefix + value;
const actorId = id("head");
const month = "2013-09";
let originalSchedule: SchoolHoursSchedule | null;
let originalFeature: {
  enabled: boolean;
  pendingEnabled: boolean | null;
} | null;
const originalSecret = process.env.AUTH_SECRET;
const createdReports = new Set<string>();
const automaticAudits = new Set<string>();
async function sweep(now: Date) {
  const where = {
    operation: {
      in: ["schoolHours.occurrenceSkipped", "schoolHours.sweepBlocked"],
    },
  };
  const previous = new Set(
    (await db.auditLog.findMany({ where, select: { id: true } })).map(
      (row) => row.id,
    ),
  );
  try {
    return await sweepSchoolHours(db, now);
  } finally {
    for (const row of await db.auditLog.findMany({
      where,
      select: { id: true },
    }))
      if (!previous.has(row.id)) automaticAudits.add(row.id);
  }
}

async function adjustment(
  key: string,
  tutor: string,
  amount: number,
  type: "EXTRA" | "PUNISHMENT" = "EXTRA",
) {
  return db.serviceHourAdjustment.create({
    data: {
      id: id(key),
      tutorId: id(tutor),
      month: "2012-01",
      schoolYear: "11-12",
      quarter: "Q2",
      type,
      amount,
    },
  });
}
async function session(key: string, amount: number) {
  return db.session.create({
    data: {
      id: id(key),
      tutorId: id("A"),
      pairingId: id("pairing"),
      date: new Date("2012-01-01T00:00:00Z"),
      month: "2012-01",
      schoolYear: "11-12",
      quarter: "Q2",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 1,
      shCount: amount,
    },
  });
}
const participantRow = (
  report: Pick<SchoolHoursSnapshot, "rows">,
  beneficiaryId = `tutor:${id("B")}`,
) => report.rows.find((row) => row.beneficiaryId === beneficiaryId)!;

async function reviewOpening(client: DomainDb = db) {
  const preview = await schoolHoursBaselinePreview(client);
  await reviewSchoolHoursBaseline(
    client,
    {
      expectedContentHash: preview.contentHash,
      expectedBaselineVersion: preview.baselineVersion,
      acknowledged: true,
      reason: "Synthetic opening reconciliation against the school ledger",
      participants: preview.participants.map((row) => ({
        beneficiaryId: row.beneficiaryId,
        schoolAccountKey: `school:${row.beneficiaryId}`,
        earned: 0,
        extras: 0,
        deductions: 0,
        crew: 0,
        reviewed: true,
      })),
    },
    actorId,
  );
}
async function enable(client: DomainDb = db) {
  await saveSchoolHoursSettings(
    client,
    {
      enabled: true,
      recipientEmails: ["school@example.test"],
      timeZone: "Asia/Shanghai",
      includeStatistics: false,
      dateOverrides: {},
      expectedVersion: 0,
    },
    actorId,
  );
}
async function issue(
  selectedMonth = month,
  reason?: string,
  client: DomainDb = db,
) {
  const preview = await previewSchoolHours(client, selectedMonth);
  const input = {
    month: selectedMonth,
    expectedVersion: preview.configVersion,
    expectedBaselineVersion: preview.baselineVersion,
    expectedHeadId: preview.expectedHeadId,
    expectedContentHash: preview.contentHash,
    requestId: randomUUID(),
    reason,
  };
  const receipt = await generateSchoolHours(client, input, actorId);
  createdReports.add(receipt.reportId);
  return {
    input,
    receipt,
    report: await getSchoolHoursReport(client, receipt.reportId),
  };
}
async function cleanReports() {
  const reports = await db.schoolHoursReport.findMany({
    where: {
      OR: [{ generatedById: actorId }, { id: { in: [...createdReports] } }],
    },
    select: { id: true },
  });
  const reportIds = reports.map((row) => row.id);
  await db.emailDelivery.deleteMany({
    where: { schoolHoursReportId: { in: reportIds } },
  });
  await db.auditLog.deleteMany({
    where: { userId: actorId, operation: { startsWith: "schoolHours." } },
  });
  await db.auditLog.deleteMany({ where: { id: { in: [...automaticAudits] } } });
  automaticAudits.clear();
  await db.schoolHoursReport.deleteMany({ where: { id: { in: reportIds } } });
  createdReports.clear();
}
async function cleanSources() {
  await db.importedRecordProvenance.deleteMany({
    where: { recordId: { startsWith: prefix } },
  });
  await db.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.patrol.deleteMany({ where: { id: { startsWith: prefix } } });
}
beforeAll(async () => {
  process.env.AUTH_SECRET = "school-hours-synthetic-test-link-secret";
  originalSchedule = await db.schoolHoursSchedule.findUnique({
    where: { id: "program" },
  });
  originalFeature = await db.programFeature.findUnique({
    where: { key: "SERVICE_HOURS" },
    select: { enabled: true, pendingEnabled: true },
  });
  await db.programFeature.upsert({
    where: { key: "SERVICE_HOURS" },
    create: { key: "SERVICE_HOURS", enabled: true },
    update: { enabled: true },
  });
  await db.user.createMany({
    data: [
      { id: actorId, email: `${actorId}@example.test`, role: "HEAD" },
      {
        id: id("crew"),
        email: `${id("crew")}@example.test`,
        role: "CREW",
        firstName: "Crew",
        lastName: "Synthetic",
      },
    ],
  });
  await db.tutor.createMany({
    data: ["A", "B", "C", "D"].map((key) => ({
      id: id(key),
      englishName: "Duplicate Synthetic Name",
      firstName: "Legal",
      lastName: key,
      status: key === "B" ? ("ARCHIVED" as const) : ("ACTIVE" as const),
    })),
  });
  await db.term.create({
    data: {
      id: id("term"),
      name: "Synthetic past semester",
      schoolYear: "11-12",
      quarter: "Q2",
    },
  });
  await db.pairing.create({
    data: {
      id: id("pairing"),
      tutorId: id("A"),
      termId: id("term"),
      subject: "Synthetic",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
});
beforeEach(async () => {
  await cleanReports();
  await cleanSources();
  await db.user.updateMany({
    where: {
      id: { startsWith: prefix, notIn: [actorId, id("crew")] },
      mergedIntoId: null,
    },
    data: { tutorId: null },
  });
  await db.user.deleteMany({
    where: { id: { startsWith: prefix, notIn: [actorId, id("crew")] } },
  });
  await db.schoolHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program" },
    update: {
      enabled: false,
      recipientEmails: [],
      recipientLabels: {},
      version: 0,
      baselineVersion: 0,
      openingBaseline: { people: [], sources: [] },
      openingReviewedAt: null,
      headReportId: null,
      nextMonth: null,
      nextDueAt: null,
      lastGenerationError: null,
    },
  });
  await session("earned", 8);
  await adjustment("standing-absence", "A", 1, "PUNISHMENT");
  await adjustment("extra-B", "B", 2);
  await adjustment("extra-C", "C", 2);
  await db.patrol.create({
    data: { id: id("patrol"), crewUserId: id("crew"), hours: 0.5 },
  });
});
afterAll(async () => {
  await cleanReports();
  await cleanSources();
  await db.pairing.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.term.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutor.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  if (originalSchedule) {
    const {
      id: scheduleId,
      openingBaseline,
      dateOverrides,
      recipientLabels,
      ...fields
    } = originalSchedule;
    await db.schoolHoursSchedule.update({
      where: { id: scheduleId },
      data: {
        ...fields,
        dateOverrides: dateOverrides as Prisma.InputJsonObject,
        recipientLabels: recipientLabels as Prisma.InputJsonObject,
        openingBaseline:
          openingBaseline == null
            ? Prisma.DbNull
            : (openingBaseline as Prisma.InputJsonObject),
      },
    });
  } else await db.schoolHoursSchedule.delete({ where: { id: "program" } });
  if (originalFeature)
    await db.programFeature.update({
      where: { key: "SERVICE_HOURS" },
      data: originalFeature,
    });
  else await db.programFeature.delete({ where: { key: "SERVICE_HOURS" } });
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

it("requires explicit per-person opening review; previews are read-only and each account gets its own instruction", async () => {
  const before = await schoolHoursBaselinePreview(db);
  expect(
    before.participants.filter((row) => row.beneficiaryId.includes(prefix)),
  ).toHaveLength(4);
  expect(before.blockers.some((row) => row.code === "BASELINE_REQUIRED")).toBe(
    true,
  );
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(0);
  await reviewOpening();
  await enable();
  const { report } = await issue();
  const own = report.rows.filter((row) => row.beneficiaryId.includes(prefix));
  expect(own.map((row) => row.hoursToAdd).sort((a, b) => a - b)).toEqual([
    0.5, 2, 2, 7,
  ]);
  expect(
    own.find((row) => row.beneficiaryId === `tutor:${id("B")}`)?.hoursToAdd,
  ).toBe(2);
  expect(new Set(own.map((row) => row.schoolAccountKey)).size).toBe(4);
});

it("retains imported archive hours without adding opening-review identities or school credit", async () => {
  await session("archive-session", 100);
  await adjustment("archive-adjustment", "D", 50);
  await db.patrol.create({
    data: { id: id("archive-patrol"), crewUserId: id("crew"), hours: 25 },
  });
  await db.importedRecordProvenance.createMany({
    data: [
      { entity: "Session", recordId: id("archive-session") },
      { entity: "ServiceHourAdjustment", recordId: id("archive-adjustment") },
      { entity: "Patrol", recordId: id("archive-patrol") },
    ],
  });
  const opening = await schoolHoursBaselinePreview(db);
  expect(opening.archivedSourceCount).toBe(3);
  expect(
    opening.participants.some(
      (row) => row.beneficiaryId === `tutor:${id("D")}`,
    ),
  ).toBe(false);
  expect(
    opening.participants.find((row) => row.beneficiaryId === `tutor:${id("A")}`)
      ?.current.earned,
  ).toBe(8);
  expect(
    opening.participants.find(
      (row) => row.beneficiaryId === `user:${id("crew")}`,
    )?.current.crew,
  ).toBe(0.5);
  expect(
    await db.serviceHourAdjustment.findUniqueOrThrow({
      where: { id: id("archive-adjustment") },
    }),
  ).toMatchObject({ amount: 50 });
  await reviewOpening();
  await enable();
  const { report } = await issue();
  expect(
    report.rows.find((row) => row.beneficiaryId === `tutor:${id("A")}`)
      ?.hoursToAdd,
  ).toBe(7);
  expect(
    report.rows.some((row) => row.beneficiaryId === `tutor:${id("D")}`),
  ).toBe(false);
});

it("keeps imports after a committed issue separate from native late credits and carried source-withdrawal debt", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await session("archive-after-issue", 100);
  await db.importedRecordProvenance.create({
    data: { entity: "Session", recordId: id("archive-after-issue") },
  });
  await session("native-late-correction", 0.25);
  await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
  const next = await previewSchoolHours(db, "2013-10");
  expect(next.archivedSourceCount).toBe(1);
  expect(next.blockers).toEqual([]);
  expect(participantRow(next, `tutor:${id("A")}`)).toMatchObject({
    tutoringChange: 0.25,
    hoursToAdd: 0.2,
    carryOutHours: "0.05",
  });
  expect(participantRow(next)).toMatchObject({
    tutoringChange: -2,
    hoursToAdd: 0,
    carryOutHours: "-2",
  });
  await issue("2013-10");
  await adjustment("archive-does-not-repay-debt", "B", 100);
  await db.importedRecordProvenance.create({
    data: {
      entity: "ServiceHourAdjustment",
      recordId: id("archive-does-not-repay-debt"),
    },
  });
  const afterImport = await previewSchoolHours(db, "2013-11");
  expect(afterImport.archivedSourceCount).toBe(2);
  expect(afterImport.blockers).toEqual([]);
  expect(participantRow(afterImport)).toMatchObject({
    tutoringChange: 0,
    hoursToAdd: 0,
    carryInHours: "-2",
    carryOutHours: "-2",
    unchanged: true,
  });
});

it.each(["opening", "committed"] as const)(
  "blocks reimported %s source evidence rather than issuing a false reversal",
  async (stage) => {
    await reviewOpening();
    await enable();
    if (stage === "committed") await issue();
    // A deleted source restored from CSV receives provenance; its logical ID was
    // already reviewed, so archive exclusion cannot silently reverse that credit.
    await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
    await adjustment("extra-B", "B", 2);
    await db.importedRecordProvenance.create({
      data: { entity: "ServiceHourAdjustment", recordId: id("extra-B") },
    });
    const next = await previewSchoolHours(db, "2013-10");
    expect(next.blockers).toContainEqual(
      expect.objectContaining({
        code: "IMPORTED_SOURCE_REQUIRES_RECONCILIATION",
        beneficiaryId: `tutor:${id("B")}`,
      }),
    );
    await expect(issue("2013-10")).rejects.toThrow("restored as an archive");
    await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
    const removedAgain = await previewSchoolHours(db, "2013-10");
    expect(removedAgain.blockers).toContainEqual(
      expect.objectContaining({
        code: "IMPORTED_SOURCE_REQUIRES_RECONCILIATION",
      }),
    );
  },
);

it("retains independent reviewed source evidence while saving an opening review in batches", async () => {
  let opening = await schoolHoursBaselinePreview(db);
  const reviewOne = async (beneficiaryId: string) => {
    await reviewSchoolHoursBaseline(
      db,
      {
        expectedContentHash: opening.contentHash,
        expectedBaselineVersion: opening.baselineVersion,
        acknowledged: true,
        reason: "Synthetic individually verified opening balance",
        participants: [
          {
            beneficiaryId,
            schoolAccountKey: `school:${beneficiaryId}`,
            earned: 0,
            extras: 0,
            deductions: 0,
            crew: 0,
            reviewed: true,
          },
        ],
      },
      actorId,
    );
    opening = await schoolHoursBaselinePreview(db);
  };
  await reviewOne(`tutor:${id("A")}`);
  expect(
    opening.participants.find((row) => row.beneficiaryId === `tutor:${id("A")}`)
      ?.needsReview,
  ).toBe(false);
  expect(
    opening.participants.find((row) => row.beneficiaryId === `tutor:${id("B")}`)
      ?.needsReview,
  ).toBe(true);
  let config = await db.schoolHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  expect(config.openingBaseline).toMatchObject({
    sources: expect.arrayContaining([
      expect.objectContaining({ key: `session:${id("earned")}` }),
    ]) as unknown,
  });
  await reviewOne(`tutor:${id("B")}`);
  config = await db.schoolHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  expect(config.openingBaseline).toMatchObject({
    sources: expect.arrayContaining([
      expect.objectContaining({ key: `session:${id("earned")}` }),
      expect.objectContaining({ key: `adjustment:${id("extra-B")}` }),
    ]) as unknown,
  });
  await expect(enable()).rejects.toThrow("Review every opening balance");
});

it("journals provenance changes against a tracked source as unsupported recovery consequences", async () => {
  await expect(
    db.$transaction(async (tx) => {
      const actionId = id("archive-boundary-recovery");
      await tx.recoveryAction.create({
        data: {
          id: actionId,
          kind: "DOMAIN_CHECKPOINT",
          applicationId: id("synthetic-checkpoint"),
          before: {},
        },
      });
      await tx.recoveryTrackedEntity.create({
        data: { actionId, entity: "Session", recordId: id("earned") },
      });
      await tx.importedRecordProvenance.create({
        data: { entity: "Session", recordId: id("earned") },
      });
      const change = await tx.recoveryChange.findFirstOrThrow({
        where: { actionId, entity: "ImportedRecordProvenance" },
      });
      expect(change.after).toMatchObject({ recordId: id("earned") });
      const event = await tx.recoveryEvent.findUniqueOrThrow({
        where: { id: change.eventId },
      });
      expect(event.kind).toBe("UNSUPPORTED");
      throw new Error("rollback synthetic archive boundary recovery");
    }),
  ).rejects.toThrow("rollback synthetic archive boundary recovery");
});

it("does not repeat standing deductions or recreated logical adjustment records; late historical sessions enter the next issue", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await db.serviceHourAdjustment.delete({
    where: { id: id("standing-absence") },
  });
  await adjustment("standing-absence", "A", 1, "PUNISHMENT");
  await session("late-past-year", 1.25);
  const { report } = await issue("2013-10");
  const row = report.rows.find(
    (item) => item.beneficiaryId === `tutor:${id("A")}`,
  )!;
  expect(row.change).toEqual({
    earned: 1.25,
    extras: 0,
    deductions: 0,
    crew: 0,
  });
  expect(row.hoursToAdd).toBe(1.2);
  expect(row.carryInHours).toBe("0");
  expect(row.carryOutHours).toBe("0.05");
  expect(row.previousMonthAmount).toBe(7);
  const next = await previewSchoolHours(db, "2013-11");
  expect(
    next.rows
      .filter((item) => item.beneficiaryId.includes(prefix))
      .every((item) => item.hoursToAdd === 0),
  ).toBe(true);
});

it("posts eighty minutes as 1.3 hours, persists the remainder and posts it once with the next four minutes", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 80 / 60 },
  });
  await reviewOpening();
  await enable();
  const first = await issue();
  const firstRow = participantRow(first.report);
  expect(first.report.postingPolicy).toBe("TENTH_HOUR_CARRY_NONNEGATIVE");
  expect(firstRow).toMatchObject({
    current: { extras: 80 / 60 },
    previous: { extras: 0 },
    change: { extras: 80 / 60 },
    tutoringChange: 80 / 60,
    crewChange: 0,
    hoursToAdd: 1.3,
    monthAmount: 1.3,
    carryInHours: "0",
  });
  expect(
    new Prisma.Decimal(firstRow.carryOutHours!).times(60).toNumber(),
  ).toBeCloseTo(2, 12);
  const stored = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: first.receipt.reportId },
  });
  const storedPeople = (stored.sourceBaseline as Prisma.JsonObject)
    .people as Prisma.JsonObject[];
  expect(
    storedPeople.find(
      (person) => person.beneficiaryId === firstRow.beneficiaryId,
    ),
  ).toMatchObject({
    beneficiaryId: firstRow.beneficiaryId,
    carryHours: firstRow.carryOutHours,
    components: { extras: 80 / 60 },
  });
  expect(schoolHoursSnapshotSchema.parse(stored.snapshot).rows).toEqual(
    first.report.rows,
  );
  const before = await previewSchoolHours(db, "2013-10");
  const repeated = await previewSchoolHours(db, "2013-10");
  expect(repeated.contentHash).toBe(before.contentHash);
  expect(participantRow(repeated)).toMatchObject({
    hoursToAdd: 0,
    unchanged: true,
    carryInHours: firstRow.carryOutHours,
    carryOutHours: firstRow.carryOutHours,
  });
  expect(await generateSchoolHours(db, first.input, actorId)).toMatchObject({
    reportId: first.receipt.reportId,
  });
  await retrySchoolHoursReport(db, first.receipt.reportId, actorId);
  expect(
    (await db.schoolHoursReport.findUniqueOrThrow({ where: { id: stored.id } }))
      .sourceBaseline,
  ).toEqual(stored.sourceBaseline);
  await adjustment("next-four-minutes", "B", 4 / 60);
  const second = await issue("2013-10");
  const secondRow = participantRow(second.report);
  expect(secondRow).toMatchObject({
    hoursToAdd: 0.1,
    monthAmount: 0.1,
    previousMonthAmount: 1.3,
    carryInHours: firstRow.carryOutHours,
  });
  expect(secondRow.change.extras).toBeCloseTo(4 / 60, 12);
  expect(
    new Prisma.Decimal(secondRow.carryOutHours!).abs().toNumber(),
  ).toBeLessThan(1e-12);
  expect(participantRow(await previewSchoolHours(db, "2013-11"))).toMatchObject(
    {
      hoursToAdd: 0,
      unchanged: true,
      carryInHours: secondRow.carryOutHours,
      carryOutHours: secondRow.carryOutHours,
    },
  );
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(2);
});

it("keeps the full debt through deductions, sign crossings and source removal", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 0.15 },
  });
  await reviewOpening();
  await enable();
  expect(participantRow((await issue()).report)).toMatchObject({
    hoursToAdd: 0.1,
    carryOutHours: "0.05",
  });
  await adjustment("carry-penalty", "B", 0.08, "PUNISHMENT");
  const reversal = participantRow((await issue("2013-10")).report);
  expect(reversal).toMatchObject({
    tutoringChange: -0.08,
    hoursToAdd: 0,
    carryInHours: "0.05",
    carryOutHours: "-0.03",
    unchanged: false,
  });
  await db.serviceHourAdjustment.update({
    where: { id: id("carry-penalty") },
    data: { amount: 0.17 },
  });
  expect(participantRow((await issue("2013-11")).report)).toMatchObject({
    hoursToAdd: 0,
    carryInHours: "-0.03",
    carryOutHours: "-0.12",
  });
  await db.serviceHourAdjustment.delete({ where: { id: id("carry-penalty") } });
  expect(participantRow((await issue("2013-12")).report)).toMatchObject({
    tutoringChange: 0.17,
    hoursToAdd: 0,
    carryInHours: "-0.12",
    carryOutHours: "0.05",
  });
  await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
  expect(participantRow((await issue("2014-01")).report)).toMatchObject({
    tutoringChange: -0.15,
    hoursToAdd: 0,
    carryInHours: "0.05",
    carryOutHours: "-0.1",
  });
});

it("persists eighty minutes of debt across unchanged issues, retry and a fresh client before later credits repay it", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await adjustment("eighty-minute-debt", "B", 80 / 60, "PUNISHMENT");
  const debt = await issue("2013-10");
  const debtRow = participantRow(debt.report);
  expect(debtRow).toMatchObject({
    tutoringChange: -(80 / 60),
    hoursToAdd: 0,
    monthAmount: 0,
    carryInHours: "0",
    carryOutHours: "-1.3333333333333333",
    unchanged: false,
  });
  const saved = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: debt.receipt.reportId },
  });
  const baseline = saved.sourceBaseline as Prisma.JsonObject;
  const people = baseline.people as Prisma.JsonObject[];
  expect(
    people.find((person) => person.beneficiaryId === debtRow.beneficiaryId),
  ).toMatchObject({ carryHours: debtRow.carryOutHours });
  const before = await previewSchoolHours(db, "2013-11");
  expect(participantRow(before)).toMatchObject({
    change: { earned: 0, extras: 0, deductions: 0, crew: 0 },
    hoursToAdd: 0,
    carryInHours: debtRow.carryOutHours,
    carryOutHours: debtRow.carryOutHours,
    unchanged: true,
  });
  expect((await previewSchoolHours(db, "2013-11")).contentHash).toBe(
    before.contentHash,
  );
  expect(await generateSchoolHours(db, debt.input, actorId)).toMatchObject({
    reportId: debt.receipt.reportId,
  });
  await retrySchoolHoursReport(db, debt.receipt.reportId, actorId);
  const retried = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: saved.id },
  });
  expect(retried.snapshot).toEqual(saved.snapshot);
  expect(retried.sourceBaseline).toEqual(saved.sourceBaseline);

  // A separate client models a restarted service: all carry comes from storage.
  const restarted = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: utcDatabaseUrl(process.env.DATABASE_URL!) },
      schedulingPgOptions,
    ),
  });
  try {
    const unchanged = await issue("2013-11", undefined, restarted);
    expect(participantRow(unchanged.report)).toMatchObject({
      hoursToAdd: 0,
      carryInHours: debtRow.carryOutHours,
      carryOutHours: debtRow.carryOutHours,
      unchanged: true,
    });
    await adjustment("forty-minute-repayment", "B", 40 / 60);
    const partial = participantRow(
      (await issue("2013-12", undefined, restarted)).report,
    );
    expect(partial).toMatchObject({
      hoursToAdd: 0,
      monthAmount: 0,
      carryInHours: debtRow.carryOutHours,
      unchanged: false,
    });
    expect(partial.tutoringChange).toBeCloseTo(40 / 60, 12);
    expect(
      new Prisma.Decimal(partial.carryOutHours!).times(60).toNumber(),
    ).toBeCloseTo(-40, 12);
    await adjustment("fifty-minute-repayment", "B", 50 / 60);
    const repaid = participantRow(
      (await issue("2014-01", undefined, restarted)).report,
    );
    expect(repaid).toMatchObject({
      hoursToAdd: 0.1,
      monthAmount: 0.1,
      carryInHours: partial.carryOutHours,
    });
    expect(repaid.tutoringChange).toBeCloseTo(50 / 60, 12);
    expect(
      new Prisma.Decimal(repaid.carryOutHours!).times(60).toNumber(),
    ).toBeCloseTo(4, 12);
    expect(
      participantRow(await previewSchoolHours(restarted, "2014-02")),
    ).toMatchObject({
      hoursToAdd: 0,
      carryInHours: repaid.carryOutHours,
      carryOutHours: repaid.carryOutHours,
      unchanged: true,
    });
  } finally {
    await restarted.$disconnect();
  }
});

it("keeps a same-month source withdrawal as debt without reducing already-posted month amounts", async () => {
  await reviewOpening();
  await enable();
  const first = await issue();
  await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
  const second = await issue(
    month,
    "Withdraw a source after its credit posted",
  );
  expect(participantRow(second.report)).toMatchObject({
    change: { extras: -2 },
    tutoringChange: -2,
    hoursToAdd: 0,
    monthAmount: 2,
    previousEditionAmount: 2,
    carryInHours: "0",
    carryOutHours: "-2",
    priorEditions: [{ revision: 1, monthAmount: 2, correctionToCurrent: 0 }],
  });
  await adjustment("withdrawal-partial-repayment", "B", 1);
  const third = await issue(month, "A later credit partially repays the debt");
  expect(participantRow(third.report)).toMatchObject({
    tutoringChange: 1,
    hoursToAdd: 0,
    monthAmount: 2,
    carryInHours: "-2",
    carryOutHours: "-1",
    priorEditions: [
      { revision: 1, monthAmount: 2, correctionToCurrent: 0 },
      { revision: 2, monthAmount: 2, correctionToCurrent: 0 },
    ],
  });
  expect(
    participantRow(await getSchoolHoursReport(db, first.receipt.reportId)),
  ).toMatchObject({ hoursToAdd: 2, monthAmount: 2, carryOutHours: "0" });
});

it("retains an exact tiny negative carry instead of rounding it away", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await adjustment("tiny-deficit", "B", 1e-16, "PUNISHMENT");
  const deficit = participantRow((await issue("2013-10")).report);
  expect(deficit).toMatchObject({
    tutoringChange: -1e-16,
    hoursToAdd: 0,
    carryInHours: "0",
  });
  expect(new Prisma.Decimal(deficit.carryOutHours!).equals("-1e-16")).toBe(
    true,
  );
  const unchanged = participantRow(await previewSchoolHours(db, "2013-11"));
  expect(unchanged).toMatchObject({
    hoursToAdd: 0,
    carryInHours: deficit.carryOutHours,
    carryOutHours: deficit.carryOutHours,
    unchanged: true,
  });
});

it("commits an unchanged issue without consuming or posting its carried fraction twice", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 0.15 },
  });
  await reviewOpening();
  await enable();
  await issue();
  const unchanged = await issue("2013-10");
  expect(participantRow(unchanged.report)).toMatchObject({
    change: { earned: 0, extras: 0, deductions: 0, crew: 0 },
    hoursToAdd: 0,
    monthAmount: 0,
    carryInHours: "0.05",
    carryOutHours: "0.05",
    unchanged: true,
  });
  await adjustment("complete-carried-tenth", "B", 0.05);
  expect(participantRow((await issue("2013-11")).report)).toMatchObject({
    hoursToAdd: 0.1,
    carryInHours: "0.05",
    carryOutHours: "0",
  });
  expect(participantRow(await previewSchoolHours(db, "2013-12"))).toMatchObject(
    {
      hoursToAdd: 0,
      carryInHours: "0",
      carryOutHours: "0",
    },
  );
});

it("adds only posted increments to same-month editions while keeping raw component changes", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 0.15 },
  });
  await reviewOpening();
  await enable();
  const first = await issue();
  await adjustment("same-month-four-hundredths", "B", 0.04);
  const second = await issue(
    month,
    "Small correction retained until a tenth is available",
  );
  expect(participantRow(second.report)).toMatchObject({
    change: { extras: 0.04 },
    tutoringChange: 0.04,
    hoursToAdd: 0,
    monthAmount: 0.1,
    previousEditionAmount: 0.1,
    carryInHours: "0.05",
    carryOutHours: "0.09",
    priorEditions: [{ revision: 1, monthAmount: 0.1, correctionToCurrent: 0 }],
  });
  await adjustment("same-month-two-hundredths", "B", 0.02);
  const third = await issue(
    month,
    "Accumulated correction reaches the next tenth",
  );
  expect(participantRow(third.report)).toMatchObject({
    hoursToAdd: 0.1,
    monthAmount: 0.2,
    previousEditionAmount: 0.1,
    carryInHours: "0.09",
    carryOutHours: "0.01",
    priorEditions: [
      { revision: 1, monthAmount: 0.1, correctionToCurrent: 0.1 },
      { revision: 2, monthAmount: 0.1, correctionToCurrent: 0.1 },
    ],
  });
  expect(
    participantRow(await getSchoolHoursReport(db, first.receipt.reportId)),
  ).toEqual(participantRow(first.report));
  expect(participantRow(await previewSchoolHours(db, "2013-10"))).toMatchObject(
    {
      hoursToAdd: 0,
      carryInHours: "0.01",
      carryOutHours: "0.01",
    },
  );
});

it("grandfathers an immutable legacy edition and starts its missing carry at zero", async () => {
  await expect(
    db.$transaction(
      async (tx) => {
        await tx.serviceHourAdjustment.update({
          where: { id: id("extra-B") },
          data: { amount: 2.05 },
        });
        await reviewOpening(tx);
        await enable(tx);
        const first = await issue(month, undefined, tx);
        const saved = await tx.schoolHoursReport.findUniqueOrThrow({
          where: { id: first.receipt.reportId },
        });
        // Synthetic persisted pre-policy edition, confined to this rollback.
        const legacy = schoolHoursSnapshotSchema.parse(saved.snapshot);
        delete legacy.postingPolicy;
        for (const row of legacy.rows) {
          delete row.carryInHours;
          delete row.carryOutHours;
        }
        participantRow(legacy).hoursToAdd = 2.05;
        participantRow(legacy).monthAmount = 2.05;
        legacy.totals.hoursToAdd = 11.55;
        legacy.totals.monthAmount = 11.55;
        const baseline = JSON.parse(JSON.stringify(saved.sourceBaseline)) as {
          people: { beneficiaryId: string; carryHours?: string }[];
        };
        for (const person of baseline.people) delete person.carryHours;
        await tx.schoolHoursReport.update({
          where: { id: saved.id },
          data: { snapshot: legacy, sourceBaseline: baseline },
        });
        const legacySaved = await tx.schoolHoursReport.findUniqueOrThrow({
          where: { id: saved.id },
        });
        await tx.serviceHourAdjustment.update({
          where: { id: id("extra-B") },
          data: { amount: 2.12 },
        });
        const second = await issue(
          month,
          "First correction under carry posting",
          tx,
        );
        expect(participantRow(second.report)).toMatchObject({
          hoursToAdd: 0,
          monthAmount: 2.05,
          previousEditionAmount: 2.05,
          carryInHours: "0",
          carryOutHours: "0.07",
          priorEditions: [
            { revision: 1, monthAmount: 2.05, correctionToCurrent: 0 },
          ],
        });
        await tx.serviceHourAdjustment.update({
          where: { id: id("extra-B") },
          data: { amount: 2.16 },
        });
        const third = await issue(
          month,
          "Carried correction reaches a tenth",
          tx,
        );
        expect(participantRow(third.report)).toMatchObject({
          hoursToAdd: 0.1,
          monthAmount: 2.15,
          carryInHours: "0.07",
          carryOutHours: "0.01",
          priorEditions: [
            { revision: 1, monthAmount: 2.05, correctionToCurrent: 0.1 },
            { revision: 2, monthAmount: 2.05, correctionToCurrent: 0.1 },
          ],
        });
        const retained = await tx.schoolHoursReport.findUniqueOrThrow({
          where: { id: saved.id },
        });
        expect(retained.snapshot).toEqual(legacySaved.snapshot);
        expect(retained.sourceBaseline).toEqual(legacySaved.sourceBaseline);
        expect(
          participantRow(await getSchoolHoursReport(tx, saved.id)),
        ).toMatchObject({
          hoursToAdd: 2.05,
          monthAmount: 2.05,
        });
        throw new Error("rollback synthetic legacy carry fixture");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic legacy carry fixture");
});

it("preserves an immutable negative instruction from the earlier signed-carry policy when issuing a nonnegative correction", async () => {
  await expect(
    db.$transaction(
      async (tx) => {
        await reviewOpening(tx);
        await enable(tx);
        const first = await issue(month, undefined, tx);
        const saved = await tx.schoolHoursReport.findUniqueOrThrow({
          where: { id: first.receipt.reportId },
        });
        const legacy = schoolHoursSnapshotSchema.parse(saved.snapshot);
        legacy.postingPolicy = "TENTH_HOUR_CARRY";
        participantRow(legacy).hoursToAdd = -2;
        participantRow(legacy).monthAmount = -2;
        legacy.totals.hoursToAdd -= 4;
        legacy.totals.monthAmount -= 4;
        // This rollback-only fixture models an already-issued signed instruction.
        await tx.schoolHoursReport.update({
          where: { id: saved.id },
          data: { snapshot: legacy },
        });
        await tx.serviceHourAdjustment.update({
          where: { id: id("extra-B") },
          data: { amount: 2.07 },
        });
        const correction = await issue(
          month,
          "Retain the earlier signed instruction while carrying a new credit",
          tx,
        );
        expect(correction.report.postingPolicy).toBe(
          "TENTH_HOUR_CARRY_NONNEGATIVE",
        );
        expect(participantRow(correction.report)).toMatchObject({
          hoursToAdd: 0,
          monthAmount: -2,
          previousEditionAmount: -2,
          carryInHours: "0",
          carryOutHours: "0.07",
          priorEditions: [
            { revision: 1, monthAmount: -2, correctionToCurrent: 0 },
          ],
        });
        const retained = await tx.schoolHoursReport.findUniqueOrThrow({
          where: { id: saved.id },
        });
        expect(retained.snapshot).toEqual(legacy);
        expect(retained.sourceBaseline).toEqual(saved.sourceBaseline);
        expect(await getSchoolHoursReport(tx, saved.id)).toMatchObject({
          postingPolicy: "TENTH_HOUR_CARRY",
        });
        expect(
          participantRow(await getSchoolHoursReport(tx, saved.id)),
        ).toMatchObject({ hoursToAdd: -2, monthAmount: -2 });
        throw new Error("rollback synthetic signed-carry legacy edition");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic signed-carry legacy edition");
});

it.each([false, true])(
  "preserves both merged owners' carry and enforces school-account conflicts (reviewed mapping: %s)",
  async (reviewedMapping) => {
    await expect(
      db.$transaction(
        async (tx) => {
          const retiredId = id("carry-merge-retired");
          await tx.user.create({
            data: {
              id: retiredId,
              email: `${retiredId}@example.test`,
              role: "CREW",
            },
          });
          await tx.patrol.update({
            where: { id: id("patrol") },
            data: { hours: 0.56 },
          });
          await tx.patrol.create({
            data: {
              id: id("carry-merge-patrol"),
              crewUserId: retiredId,
              hours: 0.26,
            },
          });
          await reviewOpening(tx);
          await enable(tx);
          const first = await issue(month, undefined, tx);
          const survivorId = `user:${id("crew")}`;
          expect(participantRow(first.report, survivorId).carryOutHours).toBe(
            "0.06",
          );
          expect(
            participantRow(first.report, `user:${retiredId}`).carryOutHours,
          ).toBe("0.06");
          await tx.user.update({
            where: { id: retiredId },
            data: { mergedIntoId: id("crew") },
          });
          if (reviewedMapping) {
            // Fixture for an already reviewed shared ledger identifier, not an
            // application reconciliation operation. Real independent mappings below
            // retain the normal conflict; all synthetic mutations roll back.
            const saved = await tx.schoolHoursReport.findUniqueOrThrow({
              where: { id: first.receipt.reportId },
            });
            const baseline = JSON.parse(
              JSON.stringify(saved.sourceBaseline),
            ) as {
              people: { beneficiaryId: string; schoolAccountKey: string }[];
            };
            const survivor = baseline.people.find(
              (person) => person.beneficiaryId === survivorId,
            )!;
            baseline.people.find(
              (person) => person.beneficiaryId === `user:${retiredId}`,
            )!.schoolAccountKey = survivor.schoolAccountKey;
            await tx.schoolHoursReport.update({
              where: { id: saved.id },
              data: { sourceBaseline: baseline },
            });
          }
          const preview = await previewSchoolHours(tx, "2013-10");
          expect(participantRow(preview, survivorId)).toMatchObject({
            change: { earned: 0, extras: 0, deductions: 0, crew: 0 },
            tutoringChange: 0,
            crewChange: 0,
            hoursToAdd: 0.1,
            carryInHours: "0.12",
            carryOutHours: "0.02",
            unchanged: false,
          });
          expect(
            preview.blockers.some(
              (row) => row.code === "ACCOUNT_MAPPING_CONFLICT",
            ),
          ).toBe(!reviewedMapping);
          if (reviewedMapping) {
            expect(preview.blockers).toEqual([]);
            const second = await issue("2013-10", undefined, tx);
            expect(participantRow(second.report, survivorId).hoursToAdd).toBe(
              0.1,
            );
            expect(
              participantRow(
                await previewSchoolHours(tx, "2013-11"),
                survivorId,
              ),
            ).toMatchObject({
              hoursToAdd: 0,
              carryInHours: "0.02",
              carryOutHours: "0.02",
              unchanged: true,
            });
          }
          throw new Error("rollback synthetic merged carry fixture");
        },
        { timeout: 20000 },
      ),
    ).rejects.toThrow("rollback synthetic merged carry fixture");
  },
);

it("preserves opposite individual changes and component changes whose net is zero", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await adjustment("new-penalty", "A", 2, "PUNISHMENT");
  await adjustment("new-extra", "B", 2);
  await adjustment("offset-extra", "C", 1);
  await adjustment("offset-penalty", "C", 1, "PUNISHMENT");
  const result = await previewSchoolHours(db, "2013-10");
  const a = result.rows.find(
    (row) => row.beneficiaryId === `tutor:${id("A")}`,
  )!;
  const b = result.rows.find(
    (row) => row.beneficiaryId === `tutor:${id("B")}`,
  )!;
  const c = result.rows.find(
    (row) => row.beneficiaryId === `tutor:${id("C")}`,
  )!;
  expect([a.hoursToAdd, b.hoursToAdd, c.hoursToAdd]).toEqual([0, 2, 0]);
  expect(a).toMatchObject({ tutoringChange: -2, carryOutHours: "-2" });
  expect(c.unchanged).toBe(false);
});

it("does not invent fractional corrections when adjustment IDs are rebuilt or amounts are grouped differently", async () => {
  await adjustment("fraction-one", "B", 0.1);
  await adjustment("fraction-two", "B", 0.2);
  await reviewOpening();
  await enable();
  await issue();
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { in: [id("fraction-one"), id("fraction-two")] } },
  });
  await adjustment("fraction-rebuilt", "B", 0.3);
  const unchanged = await previewSchoolHours(db, "2013-10");
  expect(
    unchanged.rows.find((row) => row.beneficiaryId === `tutor:${id("B")}`)
      ?.hoursToAdd,
  ).toBe(0);
  await db.serviceHourAdjustment.update({
    where: { id: id("fraction-rebuilt") },
    data: { amount: 0.4 },
  });
  const changed = await previewSchoolHours(db, "2013-10");
  expect(
    changed.rows.find((row) => row.beneficiaryId === `tutor:${id("B")}`)
      ?.hoursToAdd,
  ).toBe(0.1);
});

it("retains credited precision through the entire aggregation before converting the saved component to a number", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 1 },
  });
  await adjustment("precision-one", "B", 1e-16);
  await adjustment("precision-two", "B", 1e-16);
  await reviewOpening();
  await enable();
  const first = await issue();
  expect(
    first.report.rows.find((row) => row.beneficiaryId === `tutor:${id("B")}`)
      ?.current.extras,
  ).toBe(1.0000000000000002);
  expect(participantRow(first.report)).toMatchObject({
    hoursToAdd: 1,
  });
  expect(
    new Prisma.Decimal(participantRow(first.report).carryOutHours!).equals(
      "0.0000000000000002",
    ),
  ).toBe(true);
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { in: [id("precision-one"), id("precision-two")] } },
  });
  await adjustment("precision-rebuilt", "B", 2e-16);
  const unchanged = await previewSchoolHours(db, "2013-10");
  expect(
    unchanged.rows.find((row) => row.beneficiaryId === `tutor:${id("B")}`)
      ?.hoursToAdd,
  ).toBe(0);
  expect(
    new Prisma.Decimal(participantRow(unchanged).carryOutHours!).equals(
      "0.0000000000000002",
    ),
  ).toBe(true);
});

it("combines tutoring and Crew before posting one tenth on the explicit account without collapsing equal display names", async () => {
  await db.serviceHourAdjustment.update({
    where: { id: id("extra-B") },
    data: { amount: 0.06 },
  });
  await db.user.create({
    data: {
      id: id("linked"),
      email: `${id("linked")}@example.test`,
      tutorId: id("B"),
      role: "TUTOR",
      firstName: "Linked",
      lastName: "Person",
    },
  });
  await db.patrol.create({
    data: { id: id("linked-patrol"), crewUserId: id("linked"), hours: 0.06 },
  });
  await reviewOpening();
  await enable();
  const result = await issue();
  const linked = result.report.rows.find(
    (row) => row.beneficiaryId === `user:${id("linked")}`,
  )!;
  expect([linked.tutoringChange, linked.crewChange, linked.hoursToAdd]).toEqual(
    [0.06, 0.06, 0.1],
  );
  expect(linked.carryOutHours).toBe("0.02");
  expect(linked.exportName).toBe("Legal B");
  expect(
    result.report.rows.some((row) => row.beneficiaryId === `tutor:${id("C")}`),
  ).toBe(true);
  // Restore the explicit link before the next fixture, without touching others.
  await db.user.update({
    where: { id: id("linked") },
    data: { tutorId: null },
  });
  await db.patrol.delete({ where: { id: id("linked-patrol") } });
  await db.user.delete({ where: { id: id("linked") } });
});

it("combines tutoring debt and Crew credits on one explicit account before posting after repayment", async () => {
  await adjustment("linked-debt-penalty", "B", 2.2, "PUNISHMENT");
  await db.user.create({
    data: {
      id: id("debt-linked"),
      email: `${id("debt-linked")}@example.test`,
      tutorId: id("B"),
      role: "TUTOR",
    },
  });
  await db.patrol.create({
    data: {
      id: id("debt-linked-patrol"),
      crewUserId: id("debt-linked"),
      hours: 0.06,
    },
  });
  await reviewOpening();
  await enable();
  const beneficiary = `user:${id("debt-linked")}`;
  expect(participantRow((await issue()).report, beneficiary)).toMatchObject({
    tutoringChange: -0.2,
    crewChange: 0.06,
    hoursToAdd: 0,
    carryInHours: "0",
    carryOutHours: "-0.14",
  });
  await adjustment("linked-debt-repayment", "B", 0.2);
  await db.patrol.create({
    data: {
      id: id("debt-linked-second-patrol"),
      crewUserId: id("debt-linked"),
      hours: 0.06,
    },
  });
  expect(
    participantRow((await issue("2013-10")).report, beneficiary),
  ).toMatchObject({
    tutoringChange: 0.2,
    crewChange: 0.06,
    hoursToAdd: 0.1,
    carryInHours: "-0.14",
    carryOutHours: "0.02",
  });
});

it("carries source-removal debt under the existing owner and retains the frozen export name", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await db.serviceHourAdjustment.delete({ where: { id: id("extra-B") } });
  const result = await previewSchoolHours(db, "2013-10");
  const row = result.rows.find(
    (item) => item.beneficiaryId === `tutor:${id("B")}`,
  )!;
  expect(row).toMatchObject({
    tutoringChange: -2,
    hoursToAdd: 0,
    carryInHours: "0",
    carryOutHours: "-2",
  });
  expect(row.exportName).toBe("Legal B");
  expect(
    result.blockers.some((item) => item.beneficiaryId === row.beneficiaryId),
  ).toBe(false);
});

it("retains factual credits after login recovery retirement and reports only subsequent changes", async () => {
  await expect(
    db.$transaction(
      async (tx) => {
        const ownerId = id("recovery-retained-owner");
        await tx.user.create({
          data: {
            id: ownerId,
            role: "TUTOR",
            tutorId: id("A"),
            email: `${ownerId}@example.test`,
          },
        });
        await reviewOpening(tx);
        await enable(tx);
        await issue(month, undefined, tx);
        // Recovery retires login authority, not the factual sessions or their owner.
        await tx.user.update({
          where: { id: ownerId },
          data: {
            recoveryVoidedAt: new Date(),
            tutorAccessRevoked: true,
          },
        });
        const afterRetirement = await previewSchoolHours(tx, "2013-10");
        expect(afterRetirement.blockers).toEqual([]);
        expect(
          afterRetirement.rows.find(
            (row) => row.beneficiaryId === `user:${ownerId}`,
          )?.hoursToAdd,
        ).toBe(0);
        await tx.serviceHourAdjustment.create({
          data: {
            id: id("recovery-late-credit"),
            tutorId: id("A"),
            type: "EXTRA",
            amount: 0.25,
            month: "2012-01",
            schoolYear: "11-12",
            quarter: "Q2",
          },
        });
        const next = await issue("2013-10", undefined, tx);
        expect(
          next.report.rows.find(
            (row) => row.beneficiaryId === `user:${ownerId}`,
          )?.hoursToAdd,
        ).toBe(0.2);
        expect(
          next.report.rows.find(
            (row) => row.beneficiaryId === `user:${ownerId}`,
          )?.carryOutHours,
        ).toBe("0.05");
        const repeated = await previewSchoolHours(tx, "2013-11");
        expect(
          repeated.rows.find((row) => row.beneficiaryId === `user:${ownerId}`)
            ?.hoursToAdd,
        ).toBe(0);
        throw new Error("rollback synthetic recovery-retained account");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic recovery-retained account");
});

it("rechecks login recovery retirement inside the school mutation fence", async () => {
  await expect(
    db.$transaction(
      async (tx) => {
        const voidedActor = id("recovery-voided-reviewer");
        await tx.user.create({
          data: {
            id: voidedActor,
            email: `${voidedActor}@example.test`,
            role: "HEAD",
            recoveryVoidedAt: new Date(),
          },
        });
        const before = await tx.schoolHoursSchedule.findUniqueOrThrow({
          where: { id: "program" },
        });
        await expect(
          saveSchoolHoursSettings(
            tx,
            {
              enabled: false,
              recipientEmails: [],
              timeZone: "Asia/Shanghai",
              includeStatistics: false,
              dateOverrides: {},
              expectedVersion: 0,
            },
            voidedActor,
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(
          await tx.schoolHoursSchedule.findUniqueOrThrow({
            where: { id: "program" },
          }),
        ).toEqual(before);
        throw new Error("rollback synthetic recovery-voided reviewer");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic recovery-voided reviewer");
});

it("retains combined Crew history under the survivor and preserves the permanent deletion guard", async () => {
  // Permanent retirement fixtures belong in a rollback transaction. The real
  // retention guard must remain enabled, including during test cleanup.
  await expect(
    db.$transaction(
      async (tx) => {
        const retired = id("retired-crew");
        await tx.user.create({
          data: {
            id: retired,
            email: `${retired}@example.test`,
            role: "CREW",
            mergedIntoId: id("crew"),
          },
        });
        await tx.patrol.create({
          data: { id: id("retired-patrol"), crewUserId: retired, hours: 0.5 },
        });
        await reviewOpening(tx);
        await enable(tx);
        await issue(month, undefined, tx);
        const result = await previewSchoolHours(tx, "2013-10");
        expect(
          result.rows.find((row) => row.beneficiaryId === `user:${id("crew")}`)
            ?.hoursToAdd,
        ).toBe(0);
        await expect(
          tx.user.delete({ where: { id: retired } }),
        ).rejects.toThrow("Combined account history must be retained");
        throw new Error("rollback synthetic retired Crew fixture");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic retired Crew fixture");
});

it("blocks a deleted Crew account's cascade rather than silently turning lost evidence into a deduction", async () => {
  await expect(
    db.$transaction(
      async (tx) => {
        const ownerId = id("removed-crew");
        await tx.user.create({
          data: { id: ownerId, email: `${ownerId}@example.test`, role: "CREW" },
        });
        await tx.patrol.create({
          data: {
            id: id("removed-crew-patrol"),
            crewUserId: ownerId,
            hours: 0.5,
          },
        });
        await reviewOpening(tx);
        await enable(tx);
        await issue(month, undefined, tx);
        await tx.user.delete({ where: { id: ownerId } });
        const result = await previewSchoolHours(tx, "2013-10");
        expect(
          result.blockers.some((item) => item.code === "OWNER_MISSING"),
        ).toBe(true);
        throw new Error("rollback synthetic removed Crew fixture");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic removed Crew fixture");
});

it("does not discard a new opening balance when its owner retires into an already-reported participant", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await expect(
    db.$transaction(
      async (tx) => {
        const ownerId = id("new-opening-owner");
        await tx.user.create({
          data: { id: ownerId, email: `${ownerId}@example.test`, role: "CREW" },
        });
        await tx.patrol.create({
          data: {
            id: id("new-opening-patrol"),
            crewUserId: ownerId,
            hours: 10,
          },
        });
        const opening = await schoolHoursBaselinePreview(tx);
        await reviewSchoolHoursBaseline(
          tx,
          {
            expectedContentHash: opening.contentHash,
            expectedBaselineVersion: opening.baselineVersion,
            acknowledged: true,
            reason:
              "New participant's ten historical hours were already reported",
            participants: [
              {
                beneficiaryId: `user:${ownerId}`,
                schoolAccountKey: "distinct-reviewed-school-account",
                earned: 0,
                extras: 0,
                deductions: 0,
                crew: 10,
                reviewed: true,
              },
            ],
          },
          actorId,
        );
        await tx.user.update({
          where: { id: ownerId },
          data: { mergedIntoId: id("crew") },
        });
        const result = await previewSchoolHours(tx, "2013-10");
        expect(
          result.rows.find((row) => row.beneficiaryId === `user:${id("crew")}`)
            ?.hoursToAdd,
        ).toBe(0);
        expect(
          result.blockers.some(
            (row) => row.code === "ACCOUNT_MAPPING_CONFLICT",
          ),
        ).toBe(true);
        throw new Error("rollback synthetic new opening retirement");
      },
      { timeout: 20000 },
    ),
  ).rejects.toThrow("rollback synthetic new opening retirement");
});

it("issues head-only same-month incremental corrections, keeps old snapshots immutable and retries without a second award", async () => {
  await reviewOpening();
  await enable();
  const first = await issue();
  await session("correction", 0.5);
  const second = await issue(month, "Late attendance correction");
  const row = second.report.rows.find(
    (item) => item.beneficiaryId === `tutor:${id("A")}`,
  )!;
  expect([row.hoursToAdd, row.monthAmount, row.previousEditionAmount]).toEqual([
    0.5, 7.5, 7,
  ]);
  expect(
    (await getSchoolHoursReport(db, first.receipt.reportId)).rows.find(
      (item) => item.beneficiaryId === row.beneficiaryId,
    )?.hoursToAdd,
  ).toBe(7);
  expect(
    (await getSchoolHoursReport(db, first.receipt.reportId)).supersededById,
  ).toBe(second.receipt.reportId);
  expect(await generateSchoolHours(db, second.input, actorId)).toMatchObject({
    reportId: second.receipt.reportId,
  });
  await retrySchoolHoursReport(db, second.receipt.reportId, actorId);
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(2);
  await issue("2013-10");
  expect(
    (await previewSchoolHours(db, month)).blockers.some(
      (item) => item.code === "ANCESTOR_MONTH",
    ),
  ).toBe(true);
});

it("freezes corrections from every prior same-month edition so a missed revision cannot duplicate or lose credit", async () => {
  await reviewOpening();
  await enable();
  await issue();
  await session("revision-two", 0.5);
  await issue(month, "Second edition");
  await session("revision-three", 0.2);
  const { report } = await issue(
    month,
    "Third edition includes a later correction",
  );
  const row = report.rows.find(
    (person) => person.beneficiaryId === `tutor:${id("A")}`,
  )!;
  expect(row.hoursToAdd).toBe(0.2);
  expect(row.monthAmount).toBe(7.7);
  expect(row.priorEditions).toEqual([
    { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
    { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
  ]);
  const next = await previewSchoolHours(db, "2013-10");
  expect(
    next.rows.find((person) => person.beneficiaryId === row.beneficiaryId)
      ?.hoursToAdd,
  ).toBe(0);
});

it("refuses stale opening review and generation, and protects committed balances from baseline overwrite", async () => {
  const stale = await schoolHoursBaselinePreview(db);
  await session("after-opening-preview", 1);
  await expect(
    reviewSchoolHoursBaseline(
      db,
      {
        expectedContentHash: stale.contentHash,
        expectedBaselineVersion: stale.baselineVersion,
        acknowledged: true,
        reason: "Stale",
        participants: stale.participants.map((row) => ({
          beneficiaryId: row.beneficiaryId,
          schoolAccountKey: row.beneficiaryId,
          earned: 0,
          extras: 0,
          deductions: 0,
          crew: 0,
          reviewed: true,
        })),
      },
      actorId,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await reviewOpening();
  await enable();
  const staleReport = await previewSchoolHours(db, month);
  await adjustment("after-report-preview", "B", 1);
  await expect(
    generateSchoolHours(
      db,
      {
        month,
        expectedVersion: staleReport.configVersion,
        expectedBaselineVersion: staleReport.baselineVersion,
        expectedHeadId: staleReport.expectedHeadId,
        expectedContentHash: staleReport.contentHash,
        requestId: randomUUID(),
      },
      actorId,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await issue();
  const current = await schoolHoursBaselinePreview(db);
  const participant = current.participants.find(
    (row) => row.beneficiaryId === `tutor:${id("A")}`,
  )!;
  await expect(
    reviewSchoolHoursBaseline(
      db,
      {
        expectedContentHash: current.contentHash,
        expectedBaselineVersion: current.baselineVersion,
        acknowledged: true,
        reason: "Attempted overwrite",
        participants: [
          {
            beneficiaryId: participant.beneficiaryId,
            schoolAccountKey: "changed",
            earned: 0,
            extras: 0,
            deductions: 0,
            crew: 0,
            reviewed: true,
          },
        ],
      },
      actorId,
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("serializes competing manual previews so a second request cannot report the same delta", async () => {
  await reviewOpening();
  await enable();
  const preview = await previewSchoolHours(db, month);
  const base = {
    month,
    expectedVersion: preview.configVersion,
    expectedBaselineVersion: preview.baselineVersion,
    expectedHeadId: preview.expectedHeadId,
    expectedContentHash: preview.contentHash,
  };
  const results = await Promise.allSettled([
    generateSchoolHours(db, { ...base, requestId: randomUUID() }, actorId),
    generateSchoolHours(db, { ...base, requestId: randomUUID() }, actorId),
  ]);
  for (const result of results)
    if (result.status === "fulfilled")
      createdReports.add(result.value.reportId);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(1);
});

it("automatic and manual issuance share the committed chain, and history CSV does not need live link signing", async () => {
  await reviewOpening();
  await enable();
  const manual = await issue();
  await db.schoolHoursSchedule.update({
    where: { id: "program" },
    data: { nextMonth: month, nextDueAt: new Date("2013-09-30T04:00:00Z") },
  });
  expect(await sweep(new Date("2013-10-01T00:00:00Z"))).toMatchObject({
    generated: false,
  });
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(1);
  delete process.env.AUTH_SECRET;
  expect((await schoolHoursCsv(db, manual.receipt.reportId)).content).toContain(
    "Legal A",
  );
  process.env.AUTH_SECRET = "school-hours-synthetic-test-link-secret";
});

it("advances an older due occurrence already covered by a later manual issue without reporting its hours again", async () => {
  await reviewOpening();
  await enable();
  await issue("2013-11");
  await db.schoolHoursSchedule.update({
    where: { id: "program" },
    data: { nextMonth: "2013-10", nextDueAt: new Date("2013-10-31T04:00:00Z") },
  });
  expect(await sweep(new Date("2013-12-01T00:00:00Z"))).toMatchObject({
    generated: false,
  });
  expect(
    (
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).nextMonth,
  ).toBe("2013-11");
  expect(await sweep(new Date("2013-12-01T00:00:00Z"))).toMatchObject({
    generated: false,
  });
  expect(
    (
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).nextMonth,
  ).toBe("2013-12");
  expect(
    await db.schoolHoursReport.count({ where: { generatedById: actorId } }),
  ).toBe(1);
  expect(
    (await previewSchoolHours(db, "2013-12")).rows
      .filter((row) => row.beneficiaryId.includes(prefix))
      .every((row) => row.hoursToAdd === 0),
  ).toBe(true);
});

it("a newer revocation defeats a stale reissue review and only a fresh review can restore access", async () => {
  await reviewOpening();
  await enable();
  const issued = await issue();
  const reportId = issued.receipt.reportId;
  const firstReview = await getSchoolHoursReport(db, reportId);
  const secondReview = await getSchoolHoursReport(db, reportId);
  const originalToken = issueSchoolHoursToken(
    reportId,
    firstReview.linkVersion,
  );
  expect(firstReview.linkVersion).toBe(1);
  expect(secondReview.linkVersion).toBe(1);
  expect(firstReview.linkUrl).toBe(`/reports/service-hours/${originalToken}`);
  expect(await retrieveSchoolHoursReport(db, originalToken)).toMatchObject({
    status: "ready",
  });

  await changeSchoolHoursLink(
    db,
    reportId,
    actorId,
    false,
    firstReview.linkVersion,
  );
  const revoked = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: reportId },
  });
  expect(revoked.linkVersion).toBe(2);
  expect(revoked.linkRevokedAt).not.toBeNull();
  expect(await retrieveSchoolHoursReport(db, originalToken)).toMatchObject({
    status: "unavailable",
  });
  await expect(
    changeSchoolHoursLink(
      db,
      reportId,
      actorId,
      true,
      secondReview.linkVersion,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    changeSchoolHoursLink(
      db,
      reportId,
      actorId,
      false,
      firstReview.linkVersion,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.schoolHoursReport.findUniqueOrThrow({
      where: { id: reportId },
    }),
  ).toEqual(revoked);

  const freshReview = await getSchoolHoursReport(db, reportId);
  expect(freshReview.linkUrl).toBeNull();
  expect(
    await changeSchoolHoursLink(
      db,
      reportId,
      actorId,
      false,
      freshReview.linkVersion,
    ),
  ).toEqual({ revoked: true });
  expect(
    await db.schoolHoursReport.findUniqueOrThrow({
      where: { id: reportId },
    }),
  ).toEqual(revoked);
  expect(
    await db.auditLog.count({
      where: { entityId: reportId, operation: "schoolHours.revokeLink" },
    }),
  ).toBe(1);

  const replacementToken = issueSchoolHoursToken(reportId, 3);
  expect(
    await changeSchoolHoursLink(
      db,
      reportId,
      actorId,
      true,
      freshReview.linkVersion,
    ),
  ).toEqual({
    linkVersion: 3,
    url: `/reports/service-hours/${replacementToken}`,
  });
  expect(await retrieveSchoolHoursReport(db, replacementToken)).toMatchObject({
    status: "ready",
  });
  expect(await retrieveSchoolHoursReport(db, originalToken)).toMatchObject({
    status: "unavailable",
  });
  const restored = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: reportId },
  });
  expect(restored.linkRevokedAt).toBeNull();
  expect(restored.snapshot).toEqual(revoked.snapshot);
  expect(restored.sourceBaseline).toEqual(revoked.sourceBaseline);
});
