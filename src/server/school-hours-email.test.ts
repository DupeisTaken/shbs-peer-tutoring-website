import { expect, it } from "vitest";
import { schoolHoursEmailCopy } from "./school-hours-email";
import {
  publicSchoolHoursReport,
  schoolHoursCsv,
  schoolHoursHtmlResponse,
} from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";

it.each([
  [1.7500000000000002, "+1.75"],
  [3.5833333333333335, "+3.5833"],
  [28.041666666666668, "+28.0417"],
  [4.083333333333334, "+4.0833"],
  [1 / 12, "+0.0833"],
  [-1 / 60, "-0.0167"],
  [1e-16, null],
  [-1e-16, null],
] as const)(
  "retains exact %s posting instructions across HTML, text and CSV beside clearly approximate summaries",
  async (value, approximation) => {
    const snapshot = schoolHoursTestSnapshot();
    const person = snapshot.rows[0]!;
    person.hoursToAdd = value;
    person.monthAmount = value;
    person.tutoringChange = value;
    person.crewChange = 0;
    const frozen = JSON.stringify(snapshot);
    const report = publicSchoolHoursReport(snapshot);
    const email = schoolHoursEmailCopy({
      report,
      reportUrl: "https://reports.example.test/saved",
    });
    const html = await schoolHoursHtmlResponse(
      report,
      "synthetic-token",
    ).text();
    const exact = `${value > 0 ? "+" : ""}${value}`;
    for (const content of [email.html, email.text, html]) {
      expect(content).toContain(`${exact} h`);
      if (approximation !== null)
        expect(content).toContain(`≈ ${approximation} h`);
      else expect(content).not.toContain("≈");
    }
    if (approximation !== null) {
      expect(email.html).toContain(`Exact / 精确值: ${exact} h`);
      expect(email.html).toContain("(approximate / 约数)");
      expect(email.text).toContain("Approximate summary / 约数摘要:");
    }
    const csv = schoolHoursCsv(report).content;
    expect(csv).toContain(`,${value},`);
    expect(csv).not.toContain("≈");
    expect(JSON.stringify(snapshot)).toBe(frozen);
  },
);

it("leads with each individual's signed account instruction and excludes private source evidence", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  const copy = schoolHoursEmailCopy({
    report,
    reportUrl: "https://reports.example.test/saved-capability",
  });
  expect(copy.subject).toBe("The Program October Report is ready");
  expect(copy.html).toContain(">View Month Report</a>");
  expect(copy.text).toContain("+7 h");
  expect(copy.text).toContain("-0.5 h");
  expect(copy.text).toContain('Alexander "Alex" Chen (陈安)');
  expect(copy.html).toContain("Blair &lt;Synthetic&gt;");
  expect(copy.html).not.toContain("Blair <Synthetic>");
  expect(copy.text).toContain("not additional amounts to add again");
  expect(copy.html).not.toContain("Optional program statistics");
  expect(`${copy.html}${copy.text}`).not.toContain("private-person");
  expect(`${copy.html}${copy.text}`).not.toContain("private-previous-report");
  expect(copy.text).not.toContain("sign in");
});
it("shows incremental per-person revision corrections and full replacement amounts without instructing duplicate credit", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
  const copy = schoolHoursEmailCopy({
    report,
    reportUrl: "https://reports.example.test/saved",
  });
  expect(copy.text).toContain(
    "apply only each person's highlighted correction",
  );
  expect(copy.text).toContain("+0.5 h");
  expect(copy.text).toContain(
    "Replacement month amount / 替代月度金额: +7.5 h",
  );
  expect(copy.text).toContain("Unchanged since r1");
  expect(copy.text).toContain("Not an additional account correction");
  expect(copy.html).toContain("Previous-month comparison");
});
it("renders previews without navigation, live capabilities or changes to the accounting body", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  const actual = schoolHoursEmailCopy({
    report,
    reportUrl: "https://reports.example.test/private-token",
  });
  const preview = schoolHoursEmailCopy({
    report,
    reportUrl: "#preview",
    preview: true,
  });
  expect(preview.subject).toBe(actual.subject);
  expect(preview.html).not.toMatch(/<a\b|href=/i);
  expect(preview.html).toContain('aria-disabled="true"');
  expect(`${preview.html}${preview.text}`).not.toContain("#preview");
  expect(preview.text.split("\n\nView Month Report")[0]).toBe(
    actual.text.split("\n\nView Month Report")[0],
  );
});
it("exports frozen names, signed numeric instructions and shared CSV formula/control protection", () => {
  const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
  report.rows[0]!.exportName = '\t＝SUM(1,2) "Synthetic"';
  report.rows[0]!.schoolAccountKey = "@unsafe-account";
  const csv = schoolHoursCsv(report);
  expect(csv.content).toContain('"\'\t＝SUM(1,2) ""Synthetic"""');
  expect(csv.content).toContain('"\'@unsafe-account"');
  expect(csv.content).toContain(",-0.5,-0.5,0,");
  expect(csv.filename).toBe("program-2026-10-r1.csv");
  expect(csv.content).not.toContain("private-person");
});

it("normal issues consistently omit fully unchanged accounts from email, public report and CSV without consuming their private baseline", () => {
  const snapshot = schoolHoursTestSnapshot();
  snapshot.includeStatistics = true;
  const report = publicSchoolHoursReport(snapshot);
  expect(snapshot.rows).toHaveLength(3);
  expect(report.rows).toHaveLength(2);
  expect(report.totals.people).toBe(2);
  const email = schoolHoursEmailCopy({
    report: snapshot,
    reportUrl: "https://reports.example.test/saved",
  });
  expect(email.text).not.toContain("Casey Synthetic");
  expect(email.html).not.toContain("Casey Synthetic");
  expect(email.html).toContain("2 individuals / 人");
  expect(schoolHoursCsv(report).content).not.toContain("Casey Synthetic");
  const revision = publicSchoolHoursReport(schoolHoursTestSnapshot(2));
  expect(revision.rows).toHaveLength(3);
  expect(
    schoolHoursEmailCopy({
      report: revision,
      reportUrl: "https://reports.example.test/saved",
    }).text,
  ).toContain("Casey Synthetic");
});

it("retains a normal-issue account with offsetting component changes even when its net amount is zero", () => {
  const snapshot = schoolHoursTestSnapshot();
  snapshot.rows[2]!.unchanged = false;
  snapshot.rows[2]!.current = { earned: 3, extras: 0, deductions: 1, crew: 0 };
  snapshot.rows[2]!.change = { earned: 1, extras: 0, deductions: 1, crew: 0 };
  const report = publicSchoolHoursReport(snapshot);
  expect(
    report.rows.find((row) => row.exportName === "Casey Synthetic")?.hoursToAdd,
  ).toBe(0);
  expect(schoolHoursCsv(report).content).toContain("Casey Synthetic");
  expect(
    schoolHoursEmailCopy({
      report,
      reportUrl: "https://reports.example.test/saved",
    }).text,
  ).toContain("Casey Synthetic");
});

it("lets a recipient who missed r2 choose the complete r1-to-r3 correction instead of only the immediate change", () => {
  const snapshot = schoolHoursTestSnapshot(3);
  const person = snapshot.rows[0]!;
  person.tutoringChange = 0.2;
  person.current = { earned: 6.7, extras: 0, deductions: 0, crew: 1 };
  person.previous = { earned: 6.5, extras: 0, deductions: 0, crew: 1 };
  person.change = { earned: 0.2, extras: 0, deductions: 0, crew: 0 };
  person.hoursToAdd = 0.2;
  person.monthAmount = 7.7;
  person.previousEditionAmount = 7.5;
  person.monthComparison = 1.7;
  snapshot.totals = {
    people: 3,
    tutoringChange: 0.2,
    crewChange: 0,
    hoursToAdd: 0.2,
    monthAmount: 7.2,
  };
  person.priorEditions = [
    { revision: 1, monthAmount: 7, correctionToCurrent: 0.7 },
    { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.2 },
  ];
  const report = publicSchoolHoursReport(snapshot);
  expect(report.rows[0]!.priorEditions).toEqual(person.priorEditions);
  const copy = schoolHoursEmailCopy({
    report,
    reportUrl: "https://reports.example.test/saved",
  });
  expect(copy.text).toContain("Correction only if r2 was last applied");
  expect(copy.text).toContain("r1 (+7 h applied) -> +0.7 h");
  expect(copy.text).toContain("r2 (+7.5 h applied) -> +0.2 h");
  expect(copy.text).toContain("Nothing applied / 从未入账 -> +7.7 h once");
  expect(copy.text).toContain(
    "Choose only one matching row; never add alternatives",
  );
  expect(copy.text).toContain("If unknown or not listed, ask the program team");
  expect(copy.html).toContain("Last applied edition → correction to apply now");
  expect(copy.html).toMatch(/r1 \(\+7 h\)<\/th><td[^>]*>\+0.7 h<\/td>/);
  expect(copy.html).toMatch(/r2 \(\+7.5 h\)<\/th><td[^>]*>\+0.2 h<\/td>/);
  const csv = schoolHoursCsv(report);
  expect(csv.content).toContain("If last applied r1: correction to apply now");
  expect(csv.content).toContain("If last applied r2: correction to apply now");
  expect(
    csv.content.split("\r\n").find((line) => line.includes("school-A")),
  ).toMatch(/,0.7,0.2$/);
  expect(csv.content).toContain("Never add alternatives");
});
