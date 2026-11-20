// @vitest-environment jsdom
import { expect, it } from "vitest";
import { schoolHoursReminderPanel } from "./school-hours-reminder-panel";
import { publicSchoolHoursReport } from "./school-hours-public";
import type {
  SchoolHoursRecipientFaultCode,
  SchoolHoursRecipientState,
} from "./school-hours-recipient";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";

const parseHTML = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");
const state = (): SchoolHoursRecipientState => ({
  report: publicSchoolHoursReport(schoolHoursTestSnapshot()),
  mailbox: "s•••@example.test",
  eligible: true,
  reminders: [],
});
const requestId = "11111111-1111-4111-8111-111111111111";
const localTime = "2099-11-12T09:30";
const scheduledFor = new Date("2099-11-12T01:30:00Z");
const review = { requestId, localTime, scheduledFor };

it.each([
  [
    "en",
    "Email me a reminder",
    "Reminder date and time",
    "Review reminder email",
  ],
  ["zh", "发送邮件提醒", "提醒日期和时间", "核对提醒邮件"],
] as const)(
  "localizes the %s native editor without changing its draft or fixed destination",
  (locale, heading, label, button) => {
    const doc = parseHTML(
      schoolHoursReminderPanel(state(), "synthetic-token", {
        locale,
        draft: { localTime, requestId },
      }),
    );
    expect(doc.querySelector("h2")?.textContent).toBe(heading);
    expect(doc.querySelector("label")?.textContent).toBe(label);
    expect(doc.querySelector("label")?.htmlFor).toBe("reminder-time");
    expect(doc.querySelector("button")?.textContent).toBe(button);
    expect(doc.querySelector("form")?.getAttribute("action")).toBe(
      `/reports/service-hours/synthetic-token?lang=${locale}`,
    );
    expect(
      doc.querySelector('input[name="operation"]')?.getAttribute("value"),
    ).toBe("review");
    expect(
      doc.querySelector('input[name="requestId"]')?.getAttribute("value"),
    ).toBe(requestId);
    expect(
      doc.querySelector('input[name="localTime"]')?.getAttribute("value"),
    ).toBe(localTime);
    expect(
      doc.querySelector("#reminder-time")?.getAttribute("aria-describedby"),
    ).toBe("reminder-time-help");
    expect(
      doc.querySelector(
        'input[name="locale"],input[name="lang"],input[name="email"],input[name="recipient"],script',
      ),
    ).toBeNull();
    expect(doc.querySelector(".reminder-notice")?.textContent).toContain(
      locale === "en" ? "do not enter them again" : "请勿重复登记",
    );
    expect(doc.querySelector(".reminder-privacy")?.textContent).toContain(
      locale === "en" ? "first visit" : "首次访问时间",
    );
    if (locale === "en")
      expect(doc.body.textContent).not.toMatch(/\p{Script=Han}/u);
    else
      expect(doc.body.textContent).not.toMatch(
        /Reminder|Review|Time zone|first visit|personal link/,
      );
  },
);

it.each(["en", "zh"] as const)(
  "retains %s on confirmation and read-only Cancel navigation",
  (locale) => {
    const current = state();
    const doc = parseHTML(
      schoolHoursReminderPanel(current, "synthetic-token", { locale, review }),
    );
    expect(doc.querySelector("details")?.open).toBe(true);
    expect(doc.querySelector("h3")?.textContent).toBe(
      locale === "en" ? "Review reminder email" : "核对提醒邮件",
    );
    expect(doc.querySelector("button")?.textContent).toBe(
      locale === "en" ? "Schedule reminder email" : "安排提醒邮件",
    );
    expect(doc.querySelector("a")?.textContent).toBe(
      locale === "en" ? "Cancel" : "取消",
    );
    expect(doc.querySelector("a")?.getAttribute("href")).toBe(
      `/reports/service-hours/synthetic-token?lang=${locale}&reminder=edit#reminder`,
    );
    expect(doc.querySelector("form")?.getAttribute("action")).toBe(
      `/reports/service-hours/synthetic-token?lang=${locale}`,
    );
    expect(
      [...doc.querySelectorAll("input")].map((input) => [
        input.name,
        input.value,
      ]),
    ).toEqual([
      ["operation", "schedule"],
      ["requestId", requestId],
      ["localTime", localTime],
    ]);
    expect(doc.querySelector(".reminder-selected-time")?.textContent).toBe(
      `${new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: current.report.timeZone }).format(scheduledFor)} (${current.report.timeZone})`,
    );
  },
);

const statuses = [
  ["PENDING", "Scheduled", "已安排"],
  ["SENDING", "Sending", "发送中"],
  ["SENT", "Sent", "已发送"],
  ["FAILED", "Delivery failed", "发送失败"],
  ["BLOCKED", "Delivery delayed", "投递延迟"],
  ["SKIPPED", "Not sent", "未发送"],
  ["CANCELLED", "Cancelled", "已取消"],
] as const;
it.each(["en", "zh"] as const)(
  "localizes all %s history states and cancellation forms",
  (locale) => {
    const current = state();
    current.reminders = statuses.map(([status], index) => ({
      id: `synthetic-${index}`,
      status,
      scheduledFor,
    }));
    const doc = parseHTML(
      schoolHoursReminderPanel(current, "synthetic-token", { locale }),
    );
    expect(
      [...doc.querySelectorAll(".reminder-status")].map(
        (node) => node.textContent,
      ),
    ).toEqual(statuses.map((row) => row[locale === "en" ? 1 : 2]));
    expect(doc.querySelector("h3")?.textContent).toBe(
      locale === "en" ? "Your reminder emails" : "您的提醒邮件",
    );
    const forms = [...doc.querySelectorAll("form")];
    expect(forms).toHaveLength(3);
    for (const form of forms) {
      expect(form.getAttribute("action")).toBe(
        `/reports/service-hours/synthetic-token?lang=${locale}`,
      );
      expect(
        form.querySelector('input[name="operation"]')?.getAttribute("value"),
      ).toBe("cancel");
      expect(form.querySelector("button")?.textContent).toBe(
        locale === "en" ? "Cancel this reminder email" : "取消此提醒邮件",
      );
      expect(
        [...form.querySelectorAll("input")].map((input) => input.name),
      ).toEqual(["operation", "reminderId"]);
    }
  },
);

const errors: SchoolHoursRecipientFaultCode[] = [
  "unavailable",
  "retired",
  "recipientRemoved",
  "writeFailed",
  "invalidTime",
  "alreadyScheduled",
  "limit",
  "sending",
];
it.each(errors)(
  "localizes %s recovery in both languages while retaining the failed draft",
  (error) => {
    for (const locale of ["en", "zh"] as const) {
      const doc = parseHTML(
        schoolHoursReminderPanel(state(), "synthetic-token", {
          locale,
          error,
          draft: { requestId, localTime },
        }),
      );
      const message = doc.querySelector('[role="alert"]')?.textContent;
      expect(message).toBeTruthy();
      expect(message).not.toContain(" / ");
      expect(/\p{Script=Han}/u.test(message ?? "")).toBe(locale === "zh");
      expect(doc.querySelector("details")?.open).toBe(true);
      expect(
        doc.querySelector('input[name="requestId"]')?.getAttribute("value"),
      ).toBe(requestId);
      expect(
        doc.querySelector('input[name="localTime"]')?.getAttribute("value"),
      ).toBe(localTime);
    }
  },
);

it.each(["en", "zh"] as const)(
  "localizes %s ineligibility without adding scheduling controls",
  (locale) => {
    const doc = parseHTML(
      schoolHoursReminderPanel(
        { ...state(), eligible: false },
        "synthetic-token",
        { locale },
      ),
    );
    expect(doc.body.textContent).toContain(
      locale === "en"
        ? "Reminders are unavailable for this report."
        : "此报告目前无法安排提醒。",
    );
    expect(doc.querySelector("form")).toBeNull();
  },
);

it("escapes retained evidence and URL-encodes the link token in localized forms", () => {
  const current = { ...state(), mailbox: '<img src=x onerror="alert(1)">' };
  const unsafeId = '"><script>synthetic</script>';
  const token = 'token?other=value&x="';
  const doc = parseHTML(
    schoolHoursReminderPanel(current, token, {
      locale: "zh",
      review: { ...review, requestId: unsafeId },
    }),
  );
  expect(doc.querySelector("script,img")).toBeNull();
  expect(doc.querySelector("strong")?.textContent).toBe(current.mailbox);
  expect(
    doc.querySelector('input[name="requestId"]')?.getAttribute("value"),
  ).toBe(unsafeId);
  expect(doc.querySelector("form")?.getAttribute("action")).toBe(
    `/reports/service-hours/${encodeURIComponent(token)}?lang=zh`,
  );
});

it("preserves bilingual defaults and existing no-locale navigation", () => {
  const doc = parseHTML(
    schoolHoursReminderPanel(state(), "synthetic-token", { review }),
  );
  expect(doc.querySelector("h2")?.textContent).toBe(
    "Email me a reminder / 发送邮件提醒",
  );
  expect(doc.querySelector("button")?.textContent).toBe(
    "Schedule reminder email / 安排提醒邮件",
  );
  expect(doc.querySelector("form")?.getAttribute("action")).toBe(
    "/reports/service-hours/synthetic-token",
  );
  expect(doc.querySelector("a")?.getAttribute("href")).toBe(
    "/reports/service-hours/synthetic-token?reminder=edit#reminder",
  );
});
