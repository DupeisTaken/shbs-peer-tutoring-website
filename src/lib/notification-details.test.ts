import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import {
  formatNotificationEvent,
  notificationEvent,
} from "./notification-events";
import {
  formatNotificationInApp,
  notificationInAppEvent,
} from "./notification-details";

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
const detail = {
  en: "Proposed assignment: Emma Example to tutor Alice Example for Mathematics. Not yet applied.",
  zh: "分配提案：将 Emma Example 分配给数学辅导伙伴 Alice Example。尚未应用。",
};
const stored = { title: "Old heading", body: "Recorded original detail" };

describe.each(["en", "zh"] as const)(
  "%s recorded notification details",
  (locale) => {
    it("names the exact proposed assignment and distinguishes another proposal", () => {
      const notice = notificationInAppEvent(
        "management_review_pending",
        {},
        detail,
      );
      const first = formatNotificationInApp(
        notice.event,
        notice.context,
        locale,
        translators[locale],
        stored,
      );
      expect(first.title).toBe(
        (locale === "en" ? en : zh).notificationEvents.management_review_pending
          .title,
      );
      expect(first.body).toBe(detail[locale]);
      const other = {
        en: detail.en.replace("Emma Example", "Frank Example"),
        zh: detail.zh.replace("Emma Example", "Frank Example"),
      };
      expect(
        formatNotificationInApp(
          notice.event,
          notificationInAppEvent(notice.event, {}, other).context,
          locale,
          translators[locale],
          stored,
        ).body,
      ).not.toBe(first.body);
      expect(first.time).toBe("");
    });

    it("retains existing typed rows' details without parsing them", () => {
      expect(
        formatNotificationInApp(
          "management_review_pending",
          {},
          locale,
          translators[locale],
          stored,
        ).body,
      ).toBe(stored.body);
    });

    it("uses localized generic copy only when both detail sources are missing", () => {
      expect(
        formatNotificationInApp(
          "management_review_pending",
          {},
          locale,
          translators[locale],
          { title: "Old", body: "  " },
        ).body,
      ).toBe(
        (locale === "en" ? en : zh).notificationEvents.management_review_pending
          .body,
      );
    });
  },
);

it("preserves only the explicit detail languages and safe event fields across reads", () => {
  const notice = notificationInAppEvent("attendance_cards_pending", {
    count: 3,
    secret: "discard",
    inAppDetail: { ...detail, secret: "discard" },
  });
  expect(notice.context).toEqual({ count: 3, inAppDetail: detail });
  expect(notificationInAppEvent(notice.event, notice.context)).toEqual(notice);
  expect(notificationEvent(notice.event, notice.context).context).toEqual({
    count: 3,
  });
  expect(
    formatNotificationEvent(notice.event, notice.context, "en", translators.en)
      ?.body,
  ).not.toContain("Emma");
});

it.each([
  null,
  [],
  "text",
  { en: "Only English" },
  { en: "", zh: "中文" },
  { en: "  ", zh: "中文" },
  { en: 42, zh: "中文" },
  { en: "a".repeat(1001), zh: "中文" },
  { en: "English", zh: "文".repeat(1001) },
])("rejects incomplete or malformed detail %j", (inAppDetail) => {
  expect(
    notificationInAppEvent("management_review_pending", { inAppDetail })
      .context,
  ).toEqual({});
  expect(
    formatNotificationInApp(
      "management_review_pending",
      { inAppDetail },
      "en",
      translators.en,
      stored,
    ).body,
  ).toBe(stored.body);
});

it("preserves bounded long text, including literal markup, as text", () => {
  const long = { en: "x".repeat(1000), zh: "文".repeat(1000) };
  expect(
    notificationInAppEvent("management_review_pending", {}, long).context
      .inAppDetail,
  ).toEqual(long);
  expect(
    notificationInAppEvent(
      "management_review_pending",
      {},
      { en: "<b>Alice & Emma</b>", zh: "<b>人物</b>" },
    ).context.inAppDetail?.en,
  ).toBe("<b>Alice & Emma</b>");
});

it("keeps unknown/legacy event text and ignores unrecognized context", () => {
  for (const event of [null, "future_event"]) {
    expect(
      formatNotificationInApp(
        event,
        { inAppDetail: detail },
        "zh",
        translators.zh,
        stored,
      ),
    ).toMatchObject(stored);
  }
});

it("uses English detail for other bundled locales and Chinese for a Chinese variant", () => {
  const context = notificationInAppEvent(
    "management_review_pending",
    {},
    detail,
  ).context;
  expect(
    formatNotificationInApp(
      "management_review_pending",
      context,
      "de",
      translators.en,
      stored,
    ).body,
  ).toBe(detail.en);
  expect(
    formatNotificationInApp(
      "management_review_pending",
      context,
      "zh-CN",
      translators.zh,
      stored,
    ).body,
  ).toBe(detail.zh);
});

it("retains recorded interview time alongside the identity detail", () => {
  const notice = notificationInAppEvent(
    "interview_scheduled",
    { startsAt: "2026-10-14T05:15:00.000Z", timeZone: "Asia/Shanghai" },
    detail,
  );
  const copy = formatNotificationInApp(
    notice.event,
    notice.context,
    "en",
    translators.en,
    stored,
  );
  expect(copy.body).toBe(detail.en);
  expect(copy.time).toContain("Asia/Shanghai");
});
