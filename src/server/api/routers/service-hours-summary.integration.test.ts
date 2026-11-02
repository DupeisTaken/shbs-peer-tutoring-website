import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { Quarter, TutorStatus } from "../../../../generated/prisma";
import { monthKey } from "~/lib/service-hours";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";

// Serial database slot only. Own and remove prefixed synthetic rows rather than
// truncating another integration file's fixtures or touching a demo database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "service-hours-summary-regression-";
const schoolYear = "81-82";
const month = "2081-09";
const id = (suffix: string) => prefix + suffix;
const statuses: TutorStatus[] = [
  "ACTIVE",
  "PENDING",
  "OPTED_OUT",
  "GRADUATED",
  "ARCHIVED",
  "TRANSFERRED",
];
const caller = (role: "HEAD" | "VIEWER" = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: id(role), email: `${role.toLowerCase()}@example.test` },
      role: role as Session["role"],
      tutorId: null,
      expires: "2099-01-01",
    },
  });

async function cleanup() {
  await db.sessionTutee.deleteMany({
    where: { sessionId: { startsWith: prefix } },
  });
  await db.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.pairing.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutee.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutor.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.term.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function session(
  key: string,
  tutor: string,
  earned: number,
  date = new Date("2081-09-15T00:00:00Z"),
  quarter: Quarter = "Q1",
  year = schoolYear,
  mergeGroupId: string | null = null,
) {
  const pairingId = id(`pairing-${key}`);
  await db.pairing.create({
    data: {
      id: pairingId,
      tutorId: id(tutor),
      termId: id(year === schoolYear ? quarter : "previous"),
      subject: "Synthetic subject",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  return db.session.create({
    data: {
      id: id(`session-${key}`),
      tutorId: id(tutor),
      pairingId,
      date,
      month: monthKey(date),
      schoolYear: year,
      quarter,
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: earned === 0 ? 0 : 1,
      shCount: earned,
      mergeGroupId,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await db.user.createMany({
    data: ["HEAD", "VIEWER"].map((role) => ({
      id: id(role),
      email: `${prefix}${role.toLowerCase()}@example.test`,
      role: role as "HEAD" | "VIEWER",
    })),
  });
  await db.term.createMany({
    data: [
      { id: id("Q1"), name: "Synthetic Q1", schoolYear, quarter: "Q1" },
      // The query picks the newest active term; do not deactivate other fixtures.
      {
        id: id("Q2"),
        name: "Synthetic Q2",
        schoolYear,
        quarter: "Q2",
        active: true,
        createdAt: new Date("2098-01-01T00:00:00Z"),
      },
      { id: id("Q3"), name: "Synthetic Q3", schoolYear, quarter: "Q3" },
      {
        id: id("previous"),
        name: "Synthetic previous year",
        schoolYear: "80-81",
        quarter: "Q1",
      },
    ],
  });
  await db.tutor.createMany({
    data: [
      ...statuses.map((status) => ({
        id: id(status),
        englishName: `Synthetic ${status}`,
        status,
      })),
      {
        id: id("duplicate-a"),
        englishName: "Synthetic Same Name",
        status: "ACTIVE",
      },
      {
        id: id("duplicate-b"),
        englishName: "Synthetic Same Name",
        status: "ACTIVE",
      },
      {
        id: id("empty"),
        englishName: "Synthetic Empty Tutor",
        status: "ACTIVE",
      },
      {
        id: id("offset-adjustments"),
        englishName: "Synthetic Offset Tutor",
        status: "ACTIVE",
      },
    ],
  });
  const zero = await session("zero", "PENDING", 0);
  const offset = await session("offset", "GRADUATED", 2);
  const transferred = await session(
    "transferred",
    "TRANSFERRED",
    3,
    new Date("2081-09-30T16:30:00Z"),
  );
  const primary = id("session-primary");
  await session(
    "primary",
    "duplicate-a",
    1,
    undefined,
    "Q1",
    schoolYear,
    primary,
  );
  await session(
    "sibling",
    "duplicate-a",
    0,
    undefined,
    "Q1",
    schoolYear,
    primary,
  );
  // Exact month scope crosses recorded terms; semester scope excludes the old
  // year and Q3, even when a backfilled record shares the same calendar month.
  await session("same-month-q2", "ACTIVE", 4, undefined, "Q2");
  await session("same-month-q3", "ACTIVE", 8, undefined, "Q3");
  await session("same-month-old-year", "ACTIVE", 16, undefined, "Q1", "80-81");
  await session(
    "october-boundary",
    "TRANSFERRED",
    5,
    new Date("2081-10-01T00:00:00Z"),
    "Q2",
  );
  await db.tutee.createMany({
    data: ["present", "excused", "unexcused"].map((key) => ({
      id: id(key),
      englishName: `Synthetic ${key}`,
    })),
  });
  await db.sessionTutee.createMany({
    data: [
      { sessionId: offset.id, tuteeId: id("present"), status: "PRESENT" },
      { sessionId: zero.id, tuteeId: id("excused"), status: "EXCUSED_ABSENT" },
      {
        sessionId: transferred.id,
        tuteeId: id("unexcused"),
        status: "UNEXCUSED_ABSENT",
      },
    ],
  });
  await db.serviceHourAdjustment.createMany({
    data: [
      {
        id: id("negative"),
        tutorId: id("OPTED_OUT"),
        type: "PUNISHMENT",
        amount: 0.5,
      },
      {
        id: id("offset"),
        tutorId: id("GRADUATED"),
        type: "PUNISHMENT",
        amount: 2,
      },
      {
        id: id("zero-adjustment"),
        tutorId: id("ARCHIVED"),
        type: "EXTRA",
        amount: 0,
      },
      {
        id: id("duplicate-extra"),
        tutorId: id("duplicate-b"),
        type: "EXTRA",
        amount: 1,
      },
      // Both adjustment types count as evidence even if they cancel exactly.
      {
        id: id("cancel-extra"),
        tutorId: id("duplicate-b"),
        type: "EXTRA",
        amount: 2,
      },
      {
        id: id("cancel-penalty"),
        tutorId: id("duplicate-b"),
        type: "PUNISHMENT",
        amount: 2,
      },
      {
        id: id("offset-extra"),
        tutorId: id("offset-adjustments"),
        type: "EXTRA",
        amount: 2,
      },
      {
        id: id("offset-penalty"),
        tutorId: id("offset-adjustments"),
        type: "PUNISHMENT",
        amount: 2,
      },
    ].map((row) => ({
      ...row,
      type: row.type as "PUNISHMENT" | "EXTRA",
      month,
      schoolYear,
      quarter: "Q1" as const,
    })),
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await db.$disconnect();
  }
});

it.each(["HEAD", "VIEWER"] as const)(
  "returns complete current-status and adjustment evidence to %s without filtering the accounting scope",
  async (role) => {
    const report = await caller(role).admin.periodSummary({ month });
    for (const status of statuses) {
      expect(
        report.rows.find((row) => row.tutorId === id(status)),
      ).toMatchObject({
        tutorId: id(status),
        active: status === "ACTIVE",
      });
    }
    expect(
      report.rows.find((row) => row.tutorId === id("PENDING")),
    ).toMatchObject({
      sessions: 1,
      adjustmentCount: 0,
      total: 0,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("OPTED_OUT")),
    ).toMatchObject({
      sessions: 0,
      adjustmentCount: 1,
      earned: 0,
      punishments: 0.5,
      total: -0.5,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("GRADUATED")),
    ).toMatchObject({
      sessions: 1,
      adjustmentCount: 1,
      earned: 2,
      punishments: 2,
      total: 0,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("ARCHIVED")),
    ).toMatchObject({
      sessions: 0,
      adjustmentCount: 1,
      earned: 0,
      extras: 0,
      total: 0,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("TRANSFERRED")),
    ).toMatchObject({
      sessions: 1,
      earned: 3,
      total: 3,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("empty")),
    ).toMatchObject({
      sessions: 0,
      adjustmentCount: 0,
      total: 0,
      active: true,
    });
    expect(
      report.rows.find((row) => row.tutorId === id("offset-adjustments")),
    ).toMatchObject({
      sessions: 0,
      adjustmentCount: 2,
      extras: 2,
      punishments: 2,
      total: 0,
    });
    expect(report.totals).toMatchObject({
      present: 1,
      excused: 1,
      unexcused: 1,
    });
    const sum = (
      key: "earned" | "extras" | "punishments" | "total" | "sessions",
    ) => report.rows.reduce((total, row) => total + row[key], 0);
    for (const key of [
      "earned",
      "extras",
      "punishments",
      "total",
      "sessions",
    ] as const)
      expect(report.totals[key]).toBe(sum(key));
  },
);

it("keeps duplicate display names as distinct tutor records and combined sibling credit at zero", async () => {
  const report = await caller().admin.periodSummary({ month });
  const duplicates = report.rows.filter(
    (row) => row.englishName === "Synthetic Same Name",
  );
  expect(duplicates).toHaveLength(2);
  expect(
    duplicates.find((row) => row.tutorId === id("duplicate-a")),
  ).toMatchObject({
    sessions: 2,
    earned: 1,
    adjustmentCount: 0,
    total: 1,
  });
  expect(
    duplicates.find((row) => row.tutorId === id("duplicate-b")),
  ).toMatchObject({
    sessions: 0,
    earned: 0,
    extras: 3,
    punishments: 2,
    adjustmentCount: 3,
    total: 1,
  });
});

it("uses recorded month buckets independently of school year and quarter, including the UTC boundary", async () => {
  const september = await caller().admin.periodSummary({
    month,
    schoolYear: "80-81",
    quarter: "Q3",
  });
  expect(september.scope.label).toBe(month);
  expect(
    september.rows.find((row) => row.tutorId === id("ACTIVE")),
  ).toMatchObject({
    sessions: 3,
    earned: 28,
  });
  const october = await caller().admin.periodSummary({ month: "2081-10" });
  expect(
    october.rows.find((row) => row.tutorId === id("TRANSFERRED")),
  ).toMatchObject({
    sessions: 1,
    earned: 5,
  });
  expect(
    october.rows.find((row) => row.tutorId === id("ARCHIVED")),
  ).toMatchObject({
    sessions: 0,
    adjustmentCount: 0,
    total: 0,
  });
});

it("defaults to the active semester while explicit quarter, semester and year retain their recorded scope", async () => {
  const activeRow = async (
    input?: Parameters<ReturnType<typeof caller>["admin"]["periodSummary"]>[0],
  ) =>
    (await caller().admin.periodSummary(input)).rows.find(
      (row) => row.tutorId === id("ACTIVE"),
    );
  expect(await activeRow()).toMatchObject({ sessions: 1, earned: 4 });
  expect(await activeRow({ schoolYear, quarter: "Q1" })).toMatchObject({
    sessions: 0,
    earned: 0,
  });
  expect(await activeRow({ schoolYear, semester: "S1" })).toMatchObject({
    sessions: 1,
    earned: 4,
  });
  expect(await activeRow({ schoolYear })).toMatchObject({
    sessions: 2,
    earned: 12,
  });
});
