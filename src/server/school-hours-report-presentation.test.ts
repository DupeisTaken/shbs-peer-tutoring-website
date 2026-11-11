// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  publicSchoolHoursReport,
  schoolHoursCsvResponse,
  schoolHoursHtmlResponse,
} from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";
import { schoolHoursReminderPanel } from "./school-hours-reminder-panel";

const parseHTML = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

const report = () => publicSchoolHoursReport(schoolHoursTestSnapshot());
const state = () => ({
  report: report(),
  mailbox: "s•••@example.test",
  eligible: true,
  reminders: [],
});

it("keeps anonymous report reading and CSV in one clear standalone report", async () => {
  const response = schoolHoursHtmlResponse(report(), "synthetic-token");
  const doc = parseHTML(await response.text());
  expect(doc.querySelectorAll("h1")).toHaveLength(1);
  expect(doc.querySelector("h1")?.textContent).toBe("School Report");
  expect(doc.querySelectorAll('a[href$="/csv"]')).toHaveLength(1);
  expect(doc.querySelector("header a.button")?.getAttribute("href")).toBe(
    "/reports/service-hours/synthetic-token/csv",
  );
  expect(
    doc.querySelector('section[aria-label="Saved school report"] table'),
  ).not.toBeNull();
  expect(doc.querySelector('a[href^="/admin"],script')).toBeNull();
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "font-src 'self'",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "default-src 'none'",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "form-action 'none'",
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(
    schoolHoursCsvResponse(report()).headers.get("Content-Security-Policy"),
  ).not.toContain("font-src");
});

it.each(["en", "zh"] as const)(
  "renders the report shell and language navigation in %s",
  async (locale) => {
    const response = schoolHoursHtmlResponse(report(), "synthetic-token", {
      locale,
    });
    const doc = parseHTML(await response.text());
    expect(doc.documentElement.lang).toBe(locale);
    expect(response.headers.get("Content-Language")).toBe(locale);
    expect(doc.querySelector("h1")?.textContent).toBe(
      locale === "en" ? "School Report" : "学校报告",
    );
    const selected = doc.querySelector('nav a[aria-current="page"]');
    expect(selected?.getAttribute("href")).toBe(
      `/reports/service-hours/synthetic-token?lang=${locale}`,
    );
    expect(doc.querySelectorAll("nav a")).toHaveLength(2);
    expect(
      doc.querySelector(".hours-button")?.getAttribute("popovertarget"),
    ).toBe(doc.querySelector(".person-details")?.id);
    expect(doc.querySelector(".person-detail-row")).toBeNull();
    expect(doc.querySelector("script,form")).toBeNull();
  },
);

it("names the reminder as email while retaining the fixed-target native review form", () => {
  const doc = parseHTML(schoolHoursReminderPanel(state(), "synthetic-token"));
  expect(doc.querySelector("summary")?.textContent).toBe(
    "Email me a reminder / 发送邮件提醒",
  );
  expect(doc.querySelector("button")?.textContent).toBe(
    "Review reminder email / 核对提醒邮件",
  );
  expect(
    doc.querySelector('input[name="operation"]')?.getAttribute("value"),
  ).toBe("review");
  expect(
    doc.querySelector('input[name="requestId"]')?.getAttribute("value"),
  ).toMatch(/^[a-f0-9-]{36}$/);
  expect(
    doc.querySelector('input[name="recipient"],input[name="email"],script'),
  ).toBeNull();
  expect(doc.querySelector("label")?.htmlFor).toBe("reminder-time");
  expect(
    doc.querySelector("#reminder-time")?.getAttribute("aria-describedby"),
  ).toBe("reminder-time-help");
});

it("retains the selected instant and explicit email confirmation/cancel navigation", () => {
  const doc = parseHTML(
    schoolHoursReminderPanel(state(), "synthetic-token", {
      review: {
        requestId: "11111111-1111-4111-8111-111111111111",
        localTime: "2099-11-12T09:30",
        scheduledFor: new Date("2099-11-12T01:30:00Z"),
      },
    }),
  );
  expect(doc.querySelector("details")?.open).toBe(true);
  expect(doc.querySelector("button")?.textContent).toBe(
    "Schedule reminder email / 安排提醒邮件",
  );
  expect(
    doc.querySelector('input[name="operation"]')?.getAttribute("value"),
  ).toBe("schedule");
  expect(
    doc.querySelector('input[name="localTime"]')?.getAttribute("value"),
  ).toBe("2099-11-12T09:30");
  expect(doc.querySelector("a")?.getAttribute("href")).toBe(
    "/reports/service-hours/synthetic-token?reminder=edit#reminder",
  );
  expect(doc.body.textContent).toContain("Asia/Shanghai");
  expect(doc.body.textContent).toContain("s•••@example.test");
});
