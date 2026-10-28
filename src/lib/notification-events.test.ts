import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import {
  formatNotificationEvent,
  notificationEvent,
  notificationEvents,
} from "./notification-events";
const translators = {
  en: createTranslator({
    locale: "en",
    messages: en,
    namespace: "notificationEvents",
  }),
  zh: createTranslator({
    locale: "zh",
    messages: zh,
    namespace: "notificationEvents",
  }),
};
it("only admits selected message sender and announcement title fields", () => {
  const privateText = "PRIVATE_BODY_AND_RECIPIENTS";
  expect(notificationEvent("message_received", {
    actorName: "  Alex   Synthetic ", body: privateText, recipients: [privateText],
    announcementTitle: privateText,
  }).context).toEqual({ actorName: "Alex Synthetic" });
  expect(notificationEvent("announcement_published", {
    announcementTitle: " Autumn tutoring ", announcementAction: "updated",
    body: privateText, actorName: privateText,
  }).context).toEqual({ announcementTitle: "Autumn tutoring", announcementAction: "updated" });
  expect(notificationEvent("announcement_published", {
    announcementTitle: "Autumn tutoring", announcementAction: privateText,
  }).context).toEqual({});
  expect(notificationEvent("message_received", { actorName: "x".repeat(161) }).context).toEqual({});
});
describe.each(["en", "zh"] as const)("%s event copy", (locale) => {
  it.each(notificationEvents)(
    "has a specific title, description and next step for %s",
    (event) => {
      const result = formatNotificationEvent(
        event,
        {},
        locale,
        translators[locale],
      );
      expect(result?.title.length).toBeGreaterThanOrEqual(3);
      expect(result?.body.length).toBeGreaterThanOrEqual(8);
      expect(result?.action.length).toBeGreaterThanOrEqual(2);
      expect(result?.body).not.toContain("undefined");
    },
  );
  it("distinguishes pending requests, scheduled interviews and recurring assignments", () => {
    const pending = formatNotificationEvent(
      "tutor_application_pending",
      {},
      locale,
      translators[locale],
    )!;
    const scheduled = formatNotificationEvent(
      "interview_scheduled",
      {},
      locale,
      translators[locale],
    )!;
    const assignment = formatNotificationEvent(
      "student_assignment_updated",
      {},
      locale,
      translators[locale],
    )!;
    expect(
      new Set([pending.title, scheduled.title, assignment.title]).size,
    ).toBe(3);
    expect(assignment.time).toBe("");
  });
  it("includes the recorded instant and IANA timezone together", () => {
    const context = {
      startsAt: "2026-10-14T05:15:00.000Z",
      timeZone: "America/New_York",
    };
    const result = formatNotificationEvent(
      "interview_scheduled",
      context,
      locale,
      translators[locale],
    )!;
    const expected = new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: context.timeZone,
    }).format(new Date(context.startsAt));
    expect(result.time).toBe(`${expected} (${context.timeZone})`);
  });
  it("distinguishes an unknown count from zero", () => {
    expect(
      formatNotificationEvent(
        "attendance_cards_pending",
        {},
        locale,
        translators[locale],
      )?.body,
    ).not.toContain("0");
    expect(
      formatNotificationEvent(
        "attendance_cards_pending",
        { count: 0 },
        locale,
        translators[locale],
      )?.body,
    ).toContain("0");
  });
});
it("retains the caller's readable legacy fallback by declining unknown event identities", () => {
  expect(formatNotificationEvent(null, {}, "en", translators.en)).toBeNull();
  expect(
    formatNotificationEvent("future_unknown", {}, "en", translators.en),
  ).toBeNull();
});
it("only copies explicit safe fields for the appropriate event", () => {
  const privateData = {
    count: 3,
    body: "Private message",
    name: "Private name",
    reason: "Private review",
    email: "private@example.test",
    startsAt: "2026-10-14T05:15:00.000Z",
    timeZone: "Asia/Shanghai",
  };
  expect(notificationEvent("message_received", privateData).context).toEqual(
    {},
  );
  expect(
    notificationEvent("attendance_cards_pending", privateData).context,
  ).toEqual({ count: 3 });
  expect(notificationEvent("interview_scheduled", privateData).context).toEqual(
    { startsAt: privateData.startsAt, timeZone: privateData.timeZone },
  );
});
it.each([
  "private text",
  { secret: "private" },
  -1,
  1.2,
  Number.MAX_SAFE_INTEGER + 1,
])("does not render malformed counts: %s", (count) => {
  expect(
    notificationEvent("attendance_cards_pending", { count }).context,
  ).toEqual({});
});
it.each([
  { startsAt: "2026-10-14", timeZone: "Asia/Shanghai" },
  { startsAt: "2026-10-14T05:15:00.000Z", timeZone: "Not/A_Zone" },
  { startsAt: "2026-02-31T05:15:00.000Z", timeZone: "Asia/Shanghai" },
  { startsAt: { secret: "private" }, timeZone: "Asia/Shanghai" },
  { startsAt: "2026-10-14T05:15:00.000Z" },
])(
  "omits unsafe/incomplete date context rather than guessing %s",
  (context) => {
    expect(notificationEvent("interview_scheduled", context).context).toEqual(
      {},
    );
  },
);
