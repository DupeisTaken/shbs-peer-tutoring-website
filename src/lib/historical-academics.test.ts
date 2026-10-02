import { describe, expect, it } from "vitest";
import {
  historicalCorrectionCsv,
  historicalCorrectionRows,
  parseHistoricalCorrectionCsv,
} from "./historical-academics";

const row = {
  recordId: "legacy-tutee:stable-1",
  expectedFingerprint: "a".repeat(64),
  rawGrade: null,
  schoolYear: null,
  evidence: "Original register",
  reason: "Corrected from archived register",
};

describe("historical academic CSV", () => {
  it.each([
    null,
    "",
    "G8",
    "初三",
    "Year 13",
    "=1+2",
    "'literal",
    "\\N",
    'IB,"DP"\nYear 1',
  ])("preserves missing and raw grade %j", (rawGrade) => {
    const input = [{ ...row, rawGrade }];
    expect(
      parseHistoricalCorrectionCsv(historicalCorrectionCsv(input)),
    ).toEqual(input);
  });
  it("retains independent reference years for the same participant", () => {
    const rows = [
      { ...row, schoolYear: "24-25" },
      { ...row, recordId: "other-year", schoolYear: "25-26" },
    ];
    expect(parseHistoricalCorrectionCsv(historicalCorrectionCsv(rows))).toEqual(
      rows,
    );
  });
  it("rejects name matching, omitted fingerprints, duplicate IDs and unsupported columns", () => {
    expect(() =>
      parseHistoricalCorrectionCsv("name,rawGrade\nSam,8"),
    ).toThrow();
    expect(() =>
      historicalCorrectionRows.parse([
        { ...row, expectedFingerprint: undefined },
      ]),
    ).toThrow();
    expect(() =>
      parseHistoricalCorrectionCsv(historicalCorrectionCsv([row, row])),
    ).toThrow();
    expect(() =>
      parseHistoricalCorrectionCsv(
        historicalCorrectionCsv([row]).replace("recordId", "name"),
      ),
    ).toThrow();
  });
  it("rejects invalid years, malformed quoting, oversized batches and missing reasons", () => {
    expect(() =>
      historicalCorrectionRows.parse([{ ...row, schoolYear: "24-27" }]),
    ).toThrow();
    expect(() => parseHistoricalCorrectionCsv('"unclosed')).toThrow();
    expect(() =>
      historicalCorrectionRows.parse(
        Array.from({ length: 51 }, (_, i) => ({ ...row, recordId: String(i) })),
      ),
    ).toThrow();
    expect(() =>
      historicalCorrectionRows.parse([{ ...row, reason: "" }]),
    ).toThrow();
  });
});
