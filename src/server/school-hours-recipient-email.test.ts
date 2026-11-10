import { expect, it } from "vitest";
import { schoolHoursEmailCopy } from "./school-hours-email";
import { schoolHoursRecipientEmailCopy } from "./school-hours-recipient-email";
import { publicSchoolHoursReport } from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";

const reportUrl = "https://reports.example.test/personal";
it.each(["en", "zh"] as const)(
  "preserves the redesign's normal email unchanged in %s",
  (locale) => {
    const input = {
      report: publicSchoolHoursReport(schoolHoursTestSnapshot()),
      locale,
      reportUrl,
    };
    expect(schoolHoursRecipientEmailCopy(input)).toEqual(
      schoolHoursEmailCopy(input),
    );
  },
);
it.each(["en", "zh"] as const)(
  "labels the requested reminder as the same saved edition in %s",
  (locale) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
    const reminder = schoolHoursRecipientEmailCopy({
      report,
      locale,
      reportUrl,
      reminder: true,
    });
    expect(
      reminder.subject.startsWith(locale === "zh" ? "提醒：" : "Reminder: "),
    ).toBe(true);
    expect(reminder.text).toContain(
      locale === "zh"
        ? "已入账的时数请勿重复登记"
        : "Do not enter hours that are already posted",
    );
    expect(reminder.html).toContain(
      locale === "zh" ? "同一已保存版本" : "same saved edition",
    );
    expect(reminder.html).not.toContain("Remind me later");
  },
);
it.each(["en", "zh"] as const)(
  "keeps individual report data out of recipient reminder notifications in %s",
  (locale) => {
    const report = publicSchoolHoursReport(schoolHoursTestSnapshot());
    const reminder = schoolHoursRecipientEmailCopy({
      report,
      locale,
      reportUrl,
      reminder: true,
    });
    for (const row of report.rows) {
      expect(`${reminder.html}${reminder.text}`).not.toContain(row.exportName);
      expect(`${reminder.html}${reminder.text}`).not.toContain(
        row.schoolAccountKey,
      );
    }
    expect(reminder.html).not.toContain("<table");
  },
);
