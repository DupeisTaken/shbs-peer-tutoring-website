import { expect, it } from "vitest";
import {
  parseSchoolHoursReportLocale,
  schoolHoursReportText,
} from "./school-hours-report-locale";

it.each(["en", "zh"] as const)(
  "accepts the explicit %s report language",
  (value) => {
    expect(parseSchoolHoursReportLocale(value)).toBe(value);
  },
);

it.each([
  undefined,
  null,
  "",
  "EN",
  "ZH",
  "en-GB",
  "zh-CN",
  " en",
  "zh ",
  "en&reminder=edit",
  "../zh",
])("keeps the bilingual default for unsupported input %s", (value) => {
  expect(parseSchoolHoursReportLocale(value)).toBeUndefined();
});

it("selects one authored language or preserves bilingual text", () => {
  expect(schoolHoursReportText("en", "Hours", "时数")).toBe("Hours");
  expect(schoolHoursReportText("zh", "Hours", "时数")).toBe("时数");
  expect(schoolHoursReportText(undefined, "Hours", "时数")).toBe(
    "Hours / 时数",
  );
});
