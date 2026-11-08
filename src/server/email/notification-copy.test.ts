import { expect, it } from "vitest";
import { notificationEmailContent } from "./notification-copy";

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
  expect(content.subject).toBe("New Private Message / 新的私信");
  expect(content.presentation.body).toContain("November 9, 2026");
  expect(content.presentation.body).toContain("Asia/Shanghai");
  expect(content.presentation.body).not.toContain(unsubscribeUrl);
  expect(content.presentation.body).not.toContain("Sign in to review");
  expect(content.presentation.body).not.toContain("PRIVATE MESSAGE");
  expect(content.presentation.action.url).toBe(common.link);
  expect(content.presentation.unsubscribeUrl).toBe(unsubscribeUrl);
  expect(content.text).toContain(common.link);
  expect(content.text).toContain(`Unsubscribe / 取消订阅: ${unsubscribeUrl}`);
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
    expect(body).toContain("您的密码已更改。");
    expect(body).toContain("If you do not recognize this activity");
    expect(body).toContain("如非本人操作");
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
  expect(content.subject).toBe("Program Update / 项目通知");
  expect(content.text).not.toMatch(/PRIVATE|UNRECOGNIZED_INTERNAL_EVENT/);
});
