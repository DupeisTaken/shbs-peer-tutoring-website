import { describe, expect, it } from "vitest";
import {
  schoolHoursRowSchema,
  schoolHoursSettingsInput,
  schoolHoursSnapshotSchema,
} from "./school-hours-input";

const settings = {
  enabled: false,
  recipientEmails: ["school@example.test"],
  timeZone: "Asia/Shanghai",
  includeStatistics: false,
  dateOverrides: {},
  expectedVersion: 0,
};

describe("school report recipient labels", () => {
  it("normalizes mailbox keys and trims optional Unicode labels", () => {
    expect(
      schoolHoursSettingsInput.parse({
        ...settings,
        recipientEmails: [" School@Example.Test ", "office@example.test"],
        recipientLabels: {
          " School@Example.Test ": "  教务处 · School office  ",
          "office@example.test": "   ",
        },
      }),
    ).toMatchObject({
      recipientEmails: ["school@example.test", "office@example.test"],
      recipientLabels: { "school@example.test": "教务处 · School office" },
    });
  });

  it("distinguishes older callers omitting metadata from explicit clearing", () => {
    expect(
      schoolHoursSettingsInput.parse(settings).recipientLabels,
    ).toBeUndefined();
    expect(
      schoolHoursSettingsInput.parse({ ...settings, recipientLabels: {} })
        .recipientLabels,
    ).toEqual({});
  });

  it.each([
    { "other@example.test": "Not a configured recipient" },
    { invalid: "Invalid mailbox" },
    { "school@example.test": "Office", "SCHOOL@example.test": "Principal" },
    { "school@example.test": "x".repeat(81) },
  ])("rejects invalid or ambiguous annotations: %j", (recipientLabels) => {
    expect(
      schoolHoursSettingsInput.safeParse({ ...settings, recipientLabels })
        .success,
    ).toBe(false);
  });

  it("bounds the complete map even when all labels are empty", () => {
    expect(
      schoolHoursSettingsInput.safeParse({
        ...settings,
        recipientLabels: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [
            `office${index}@example.test`,
            "",
          ]),
        ),
      }).success,
    ).toBe(false);
  });
});

const legacyRow = {
  beneficiaryId: "tutor:synthetic",
  exportName: "Synthetic Tutor",
  schoolAccountKey: "school:synthetic",
  nameParts: {
    firstName: "Synthetic",
    lastName: "Tutor",
    preferredName: null,
    alternativeNames: null,
    legacyName: null,
    confirmed: true,
  },
  current: { earned: 1.25, extras: 0, deductions: 0, crew: 0 },
  previous: { earned: 0, extras: 0, deductions: 0, crew: 0 },
  change: { earned: 1.25, extras: 0, deductions: 0, crew: 0 },
  tutoringChange: 1.25,
  crewChange: 0,
  hoursToAdd: 1.25,
  monthAmount: 1.25,
  previousEditionAmount: null,
  previousMonthAmount: null,
  monthComparison: null,
  unchanged: false,
};
const legacySnapshot = {
  schemaVersion: 1,
  month: "2013-09",
  revision: 1,
  generatedAt: "2013-09-30T04:00:00Z",
  timeZone: "Asia/Shanghai",
  predecessorId: null,
  supersedesId: null,
  includeStatistics: false,
  rows: [legacyRow],
  totals: {
    people: 1,
    tutoringChange: 1.25,
    crewChange: 0,
    hoursToAdd: 1.25,
    monthAmount: 1.25,
  },
};

describe("school report posting policy compatibility", () => {
  it("reads old snapshots without inventing carry fields or changing fractional postings", () => {
    const parsed = schoolHoursSnapshotSchema.parse(legacySnapshot);
    expect(parsed.postingPolicy).toBeUndefined();
    expect(parsed.rows[0]).toEqual({ ...legacyRow, priorEditions: [] });
    expect(parsed.rows[0]).not.toHaveProperty("carryInHours");
    expect(parsed.rows[0]).not.toHaveProperty("carryOutHours");
    expect(
      schoolHoursSnapshotSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(parsed);
  });

  it.each(["TENTH_HOUR_CARRY", "TENTH_HOUR_CARRY_NONNEGATIVE"])(
    "round-trips %s signed decimal carry metadata while preserving raw source changes",
    (postingPolicy) => {
      const report = {
        ...legacySnapshot,
        postingPolicy,
        rows: [
          {
            ...legacyRow,
            hoursToAdd: 1.2,
            monthAmount: 1.2,
            carryInHours: "-0.0000000000000001",
            carryOutHours: "0.0499999999999999",
          },
        ],
        totals: { ...legacySnapshot.totals, hoursToAdd: 1.2, monthAmount: 1.2 },
      };
      const parsed = schoolHoursSnapshotSchema.parse(
        JSON.parse(JSON.stringify(report)),
      );
      expect(parsed).toMatchObject(report);
      expect(parsed.rows[0]?.tutoringChange).toBe(1.25);
      expect(
        schoolHoursRowSchema.parse({
          ...legacyRow,
          carryInHours: "1e-16",
          carryOutHours: "-2e-16",
        }),
      ).toMatchObject({
        carryInHours: "1e-16",
        carryOutHours: "-2e-16",
      });
    },
  );

  it.each(
    ["TENTH_HOUR_CARRY", "TENTH_HOUR_CARRY_NONNEGATIVE"].flatMap(
      (postingPolicy) =>
        [{}, { carryInHours: "0" }, { carryOutHours: "0.05" }].map(
          (carry) => ({ postingPolicy, carry }),
        ),
    ),
  )(
    "requires both carry fields for each row under $postingPolicy: $carry",
    ({ postingPolicy, carry }) => {
      expect(
        schoolHoursSnapshotSchema.safeParse({
          ...legacySnapshot,
          postingPolicy,
          rows: [{ ...legacyRow, ...carry }],
        }).success,
      ).toBe(false);
    },
  );

  it("preserves an earlier signed-posting policy's negative immutable instruction", () => {
    const report = {
      ...legacySnapshot,
      postingPolicy: "TENTH_HOUR_CARRY",
      rows: [
        {
          ...legacyRow,
          tutoringChange: -2,
          hoursToAdd: -2,
          monthAmount: -2,
          carryInHours: "0",
          carryOutHours: "-0.03",
        },
      ],
      totals: { ...legacySnapshot.totals, hoursToAdd: -2, monthAmount: -2 },
    };
    expect(schoolHoursSnapshotSchema.parse(report)).toMatchObject(report);
    expect(
      schoolHoursSnapshotSchema.safeParse({
        ...report,
        postingPolicy: "TENTH_HOUR_CARRY_NONNEGATIVE",
      }).success,
    ).toBe(false);
  });

  it.each([
    0.05,
    "",
    "NaN",
    "Infinity",
    "-Infinity",
    "1/30",
    "1e999",
    "0.1 hours",
  ])("rejects invalid carry metadata: %j", (carryOutHours) => {
    expect(
      schoolHoursRowSchema.safeParse({
        ...legacyRow,
        carryInHours: "0",
        carryOutHours,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown posting policies", () => {
    expect(
      schoolHoursSnapshotSchema.safeParse({
        ...legacySnapshot,
        postingPolicy: "ROUND_TO_NEAREST_TENTH",
      }).success,
    ).toBe(false);
  });
});
