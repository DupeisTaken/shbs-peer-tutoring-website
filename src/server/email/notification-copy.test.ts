import { expect, it } from "vitest";
import { notificationEmailContent } from "./notification-copy";

it.each(["en", "zh"] as const)(
  "uses one accurate %s management footer for required mail and leaves optional opt-out copy intact",
  (locale) => {
    const unsubscribeUrl = "https://school.example/unsubscribe?token=synthetic";
    const input = {
      ...common,
      event: "message_received",
      context: {},
      category: "messages",
      locale,
      unsubscribeUrl,
    };
    const required = notificationEmailContent({
      ...input,
      requiredByProgram: true,
    });
    const optional = notificationEmailContent(input);
    const guidance =
      locale === "en"
        ? "administrator requires"
        : "项目管理员要求接收此类别通知";
    const managementLabel =
      locale === "en" ? "Manage email preferences" : "管理邮件偏好";
    const optionalLabel = locale === "en" ? "Unsubscribe" : "取消订阅";
    expect(required.text.split(guidance)).toHaveLength(2);
    expect(required.presentation.body.split(guidance)).toHaveLength(2);
    expect(required.presentation.unsubscribeLabel).toBe(managementLabel);
    expect(required.text).toContain(`${managementLabel}: ${unsubscribeUrl}`);
    expect(required.text).not.toContain(`${optionalLabel}:`);
    expect(required.presentation.unsubscribeUrl).toBe(
      optional.presentation.unsubscribeUrl,
    );
    expect(required.presentation.action).toEqual(optional.presentation.action);
    expect(optional.presentation.unsubscribeLabel).toBe(optionalLabel);
    expect(optional.text).toContain(`${optionalLabel}: ${unsubscribeUrl}`);
    expect(optional.text).not.toContain(guidance);
    expect(optional.presentation.body).not.toContain(guidance);
  },
);

it("does not reclassify essential security copy as an administrator-required category", () => {
  const content = notificationEmailContent({
    ...common,
    event: "security_changed",
    category: "security",
    context: { changedFields: ["password"] },
    requiredByProgram: true,
  });
  expect(content.text).toContain("If you do not recognize this activity");
  expect(content.text).not.toContain("administrator requires");
  expect(content.presentation.unsubscribeUrl).toBeUndefined();
});

const common = {
  createdAt: new Date("2026-11-09T01:30:00.000Z"),
  timeZone: "Asia/Shanghai",
  link: "https://school.example/signin?callbackUrl=%2Fmessages",
};

it("keeps the issued time and factual update without raw unsubscribe URLs or repeated sign-in instructions in HTML", () => {
  const unsubscribeUrl = "https://school.example/unsubscribe?token=synthetic";
  const content = notificationEmailContent({
    ...common,
    event: "message_received",
    context: { actorName: "Alex", body: "PRIVATE MESSAGE" },
    category: "messages",
    unsubscribeUrl,
  });
  expect(content.subject).toBe("New Private Message");
  expect(content.presentation.body).toContain("November 9, 2026");
  expect(content.presentation.body).toContain("Asia/Shanghai");
  expect(content.presentation.body).not.toContain(unsubscribeUrl);
  expect(content.presentation.body).not.toContain("Sign in to review");
  expect(content.presentation.body).not.toContain("PRIVATE MESSAGE");
  expect(content.presentation.action.url).toBe(common.link);
  expect(content.presentation.unsubscribeUrl).toBe(unsubscribeUrl);
  expect(content.text).toContain(common.link);
  expect(content.text).toContain(`Unsubscribe: ${unsubscribeUrl}`);
  expect(content.text).not.toContain("Sign in to review the update");
  expect(content.text).not.toContain(
    "optional email notifications in account settings",
  );
});

it("retains the security response guidance in both alternatives", () => {
  const content = notificationEmailContent({
    ...common,
    event: "security_changed",
    context: { changedFields: ["password"] },
    category: "security",
  });
  for (const body of [content.text, content.presentation.body]) {
    expect(body).toContain("Your password was changed.");
    expect(body).toContain("If you do not recognize this activity");
  }
  expect(content.presentation.eyebrow).toBe("ACCOUNT SECURITY");
  expect(content.presentation.unsubscribeUrl).toBeUndefined();
});

it("uses maintained generic copy for unknown legacy events instead of their supplied text", () => {
  const content = notificationEmailContent({
    ...common,
    event: "UNRECOGNIZED_INTERNAL_EVENT",
    context: { title: "PRIVATE TITLE", text: "PRIVATE BODY" },
    category: "info",
  });
  expect(content.subject).toBe("Program Update");
  expect(content.text).not.toMatch(/PRIVATE|UNRECOGNIZED_INTERNAL_EVENT/);
});

it.each(["en", "zh"] as const)(
  "selects %s factual snapshots, times, actions and security guidance without recovering private fields",
  (locale) => {
    const context = {
      emailDetail: {
        en: "Morgan is assigned to Alex.",
        zh: "Morgan 已分配给 Alex。",
      },
      private: "PRIVATE BODY",
    };
    const content = notificationEmailContent({
      ...common,
      event: "student_assignment_updated",
      category: "info",
      context,
      locale,
    });
    expect(content.presentation.locale).toBe(locale);
    expect(content.presentation.preview).not.toBe(content.subject);
    expect(content.presentation.preview).not.toMatch(
      /Morgan|Alex|PRIVATE|https:/,
    );
    expect(content.presentation.body).toContain(context.emailDetail[locale]);
    expect(content.presentation.body).not.toContain(
      context.emailDetail[locale === "en" ? "zh" : "en"],
    );
    expect(content.text).not.toContain("PRIVATE BODY");
    expect(content.presentation.body).toContain(
      locale === "en" ? "November 9, 2026" : "2026年11月9日",
    );
    const security = notificationEmailContent({
      ...common,
      event: "security_changed",
      category: "security",
      context: { changedFields: ["password"] },
      locale,
    });
    for (const body of [security.text, security.presentation.body]) {
      expect(body).toContain(
        locale === "en" ? "Your password was changed." : "您的密码已更改。",
      );
      expect(body).toContain(
        locale === "en"
          ? "If you do not recognize this activity"
          : "如非本人操作",
      );
      if (locale === "en") expect(body).not.toMatch(/\p{Script=Han}/u);
      else expect(body).not.toContain("Your password");
    }
  },
);
