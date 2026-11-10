import { describe, expect, it } from "vitest";
import { schoolHoursSettingsInput } from "./school-hours-input";

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
