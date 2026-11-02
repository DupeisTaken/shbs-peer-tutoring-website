import { expect, it } from "vitest";
import { monthlyHoursEmailCopy } from "./monthly-hours-email";
import type { MonthlyHoursSnapshot } from "./monthly-hours";

it("renders every hours-only row, preserves negative/fractional values and escapes names", () => {
  const row = {
    tutorId: "synthetic",
    englishName: "<img src=x onerror=alert(1)>",
    active: false,
    sessions: 0,
    adjustmentCount: 1,
    earned: 0,
    extras: 1 / 60,
    punishments: 0.25,
    total: 1 / 60 - 0.25,
  };
  const snapshot: MonthlyHoursSnapshot = {
    schemaVersion: 1,
    month: "2024-09",
    rows: [row],
    totals: {
      tutors: 1,
      sessions: 0,
      earned: 0,
      extras: row.extras,
      punishments: row.punishments,
      total: row.total,
    },
  };
  const input = {
    snapshot,
    revision: 2,
    generatedAt: new Date("2024-10-03T01:00:00Z"),
    timeZone: "Asia/Shanghai",
    reason: "Private correction review note",
    reportUrl: "https://example.test/saved",
    unsubscribeUrl: "https://example.test/unsubscribe",
  };
  const copy = monthlyHoursEmailCopy(input);
  expect(copy.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(copy.html).not.toContain("<img src=x");
  expect(copy.text).toContain("Inactive / 非活跃");
  expect(copy.text).toContain("-0.2333");
  expect(copy.text).toContain("https://example.test/saved");
  expect(copy.html).toContain("取消订阅");
  expect(copy.text).toContain("not a count of physical teaching blocks");
  expect(copy.text).not.toContain("Private correction review note");
  expect(copy.subject).toContain("2024-09");
  expect(copy.text).toContain("replaces r1");
  expect(copy.text).toContain(
    "TOTAL / 总计 (1 tutors / 位辅导伙伴) |  | 0 | 0 | 0.0167 | 0.25 | -0.2333",
  );
  expect(copy.html).toMatch(
    /TOTAL \/ 总计 \(1 tutors \/ 位辅导伙伴\)<\/th><th[^>]*><\/th><th[^>]*>0<\/th>/,
  );
  expect(
    [...copy.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
  ).toEqual([input.reportUrl, input.unsubscribeUrl]);
  const preview = monthlyHoursEmailCopy({ ...input, preview: true });
  expect(preview.subject).toBe(copy.subject);
  expect(preview.html).not.toMatch(/<a\b|\bhref=/i);
  expect(preview.html).toContain(
    '<span style="color:#B6D5FF" aria-disabled="true">Unsubscribe / 取消订阅</span>',
  );
  expect(`${preview.html}${preview.text}`).not.toContain(input.reportUrl);
  expect(`${preview.html}${preview.text}`).not.toContain(input.unsubscribeUrl);
  expect(/<tbody>([\s\S]*?)<\/tbody>/.exec(preview.html)?.[1]).toBe(
    /<tbody>([\s\S]*?)<\/tbody>/.exec(copy.html)?.[1],
  );
  expect(preview.text.split("\n\nView saved report")[0]).toBe(
    copy.text.split("\n\nView saved report")[0],
  );
});
