// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  codeEmailCopy,
  emailDeadline,
  historyInvitationEmailCopy,
  invitationEmailCopy,
  invitationVerificationEmailCopy,
  linkedEmailCopy,
  signupAppealEmailCopy,
  tutoringSignupEmailCopy,
} from "./direct-email-copy";
import { historyInvitationScope } from "./required-notice-details";
import { renderEmail } from "./template";

const deadline = {
  at: new Date("2026-11-09T23:30:00.000Z"),
  timeZone: "Asia/Shanghai",
};
const url = "https://school.example/continue?token=synthetic";
const purpose = { en: "read-only Viewer access", zh: "只读观察员权限" };

describe("direct delivery copy", () => {
  it("shows the full verification code once in HTML while preserving code, instructions and URL in plain text", () => {
    const copy = codeEmailCopy({
      subject: "Verify your email / 验证邮箱",
      code: "0012",
      body: "Enter this code to continue. Expires in 10 minutes.\n输入验证码以继续，10 分钟内有效。",
      action: { label: "Continue / 继续", url },
    });
    const doc = new DOMParser().parseFromString(
      renderEmail({ brand: "School", ...copy }),
      "text/html",
    );
    expect(doc.querySelectorAll(".code")).toHaveLength(1);
    expect(doc.querySelector(".code")?.textContent).toBe("0012");
    expect(doc.body.textContent?.split("0012")).toHaveLength(2);
    expect(copy.text.split("0012")).toHaveLength(2);
    expect(copy.text).toContain(copy.presentation.body);
    expect(copy.text).toContain(url);
    expect(copy.presentation.body).not.toContain(url);
    expect(doc.querySelector(".body")?.textContent).toContain("10 分钟内有效");
  });

  it("formats both languages in the program timezone across a UTC date boundary", () => {
    const text = emailDeadline(deadline);
    expect(text).toContain("November 10, 2026");
    expect(text).toContain("7:30 AM");
    expect(text).toContain("2026年11月10日");
    expect(text).toContain("07:30");
    expect(text).toContain("Asia/Shanghai");
    expect(text).not.toContain(deadline.at.toISOString());
  });

  it("preserves an outstanding legacy verification code without calling it four digits", () => {
    const copy = codeEmailCopy({
      subject: "Verify email",
      code: "AB01CD",
      body: "Enter the full code shown.",
    });
    expect(copy.text).toContain(" is AB01CD.");
    expect(copy.text).not.toContain("4 digits");
    expect(copy.text).not.toContain("4 位数字");
    expect(copy.presentation.code).toBe("AB01CD");
  });

  it("keeps invitation mailbox proof separate from access acceptance", () => {
    const copy = invitationVerificationEmailCopy({
      code: "0012",
      purpose,
      deadline,
      url,
    });
    for (const content of [copy.text, copy.presentation.body]) {
      expect(content).toContain("proves mailbox ownership");
      expect(content).toContain("accept any added access separately");
      expect(content).toContain("新增权限仍须另行确认");
      expect(content).toContain(
        "without changing their password or memberships",
      );
      expect(content).toContain(
        emailDeadline(deadline, { en: "Code expires", zh: "验证码有效期至" }),
      );
    }
    expect(copy.subject).toContain(purpose.en);
    expect(copy.subject).toContain(purpose.zh);
    expect(copy.subject).toContain("验证邮箱 · ");
  });

  it.each(["A2B3C", "012345ABCDEF"])(
    "retains complete invitation %s and its correct entry guidance",
    (code) => {
      const copy = invitationEmailCopy({ code, purpose, deadline, url });
      expect(copy.presentation.code).toBe(code);
      expect(copy.presentation.codePurpose).toBe("invitation");
      expect(copy.text).toContain(code);
      expect(copy.presentation.body).not.toContain(code);
      expect(copy.presentation.body).toContain(
        code.length === 5 ? "5 letters and numbers" : "Previously issued code",
      );
      expect(copy.presentation.body).toContain("does not grant access");
      expect(copy.presentation.body).toContain(
        emailDeadline(deadline, {
          en: "Invitation expires",
          zh: "邀请有效期至",
        }),
      );
    },
  );

  it("keeps signup completion, original priority and verification deadline in both representations", () => {
    const copy = tutoringSignupEmailCopy({ code: "0012", url, deadline });
    for (const content of [copy.text, copy.presentation.body]) {
      expect(content).toContain("signup is not complete");
      expect(content).toContain(
        "finish account review and confirm your request",
      );
      expect(content).toContain("original submission priority is kept");
      expect(content).toContain("报名尚未完成");
      expect(content).toContain(
        emailDeadline(deadline, { en: "Code expires", zh: "验证码有效期至" }),
      );
    }
    expect(copy.presentation.action?.url).toBe(url);
  });

  it("preserves the legacy link lifetime, fixed disqualification deadline and account transition", () => {
    const copy = tutoringSignupEmailCopy({
      code: "0012",
      url,
      legacy: true,
      verificationDue: deadline,
    });
    expect(copy.presentation.body).toContain(
      "Code and confirmation link expire in 24 hours",
    );
    expect(copy.presentation.body).toContain(
      "permanently disqualified and all assignments released",
    );
    expect(copy.presentation.body).toContain("Resends do not extend it");
    expect(copy.presentation.body).toContain(
      "existing account without changing its password",
    );
    expect(copy.presentation.body).toContain("review and accept it to finish");
    expect(copy.presentation.body).toContain("重发不会延长期限");
    expect(copy.text).toContain(
      emailDeadline(deadline, {
        en: "Complete verification by",
        zh: "完成验证截止时间",
      }),
    );
  });

  it("labels code expiry separately from the permanent request deadline and places both before continuation details", () => {
    const verificationDue = {
      ...deadline,
      at: new Date("2026-11-16T23:30:00.000Z"),
    };
    const copy = tutoringSignupEmailCopy({
      code: "0012",
      url,
      deadline,
      legacy: true,
      verificationDue,
    });
    for (const content of [copy.text, copy.presentation.body]) {
      expect(content).toContain("Code expires: November 10, 2026");
      expect(content).toContain("验证码有效期至：2026年11月10日");
      expect(content).toContain("Complete verification by: November 17, 2026");
      expect(content).toContain("完成验证截止时间：2026年11月17日");
      expect(content.indexOf("Code expires")).toBeLessThan(
        content.indexOf("Complete verification by"),
      );
      expect(content.indexOf("Complete verification by")).toBeLessThan(
        content.indexOf("signup is not complete"),
      );
    }
  });

  it.each([true, false])(
    "preserves reviewed history scope and explicit claim without current participation (exact=%s)",
    (exact) => {
      const scope = historyInvitationScope([
        { kind: "TUTOR" },
        { kind: "TUTEE" },
        { kind: "TUTEE" },
      ]);
      const copy = historyInvitationEmailCopy({ scope, url, exact });
      for (const content of [copy.text, copy.presentation.body]) {
        expect(content).toContain(scope.en);
        expect(content).toContain(scope.zh);
        expect(content).toContain("separate email verification code");
        expect(content).toContain("explicitly claim");
        expect(content).toContain("seven days");
        expect(content).toContain("does not enroll you");
        expect(content).toContain("accept policies for you");
      }
      expect(copy.presentation.action.label).toContain(
        "Review historical records",
      );
      if (!exact)
        expect(copy.presentation.body).toContain("old email is unavailable");
    },
  );

  it("distinguishes appeal outcomes and preserves the priority consequence", () => {
    const accepted = signupAppealEmailCopy({ kind: "APPEAL_ACCEPTED" });
    const rejected = signupAppealEmailCopy({ kind: "APPEAL_REJECTED" });
    const flagged = signupAppealEmailCopy({
      kind: "INVALID_FLAGGED",
      appealUrl: url,
    });
    expect(
      new Set([accepted.subject, rejected.subject, flagged.subject]).size,
    ).toBe(3);
    expect(accepted.subject).toContain("accepted");
    expect(accepted.text).toContain("original priority");
    expect(rejected.subject).toContain("rejected");
    expect(rejected.text).toContain("request is closed");
    expect(rejected.text).toContain("new priority");
    expect(flagged.text).toContain("current intake period ends");
    expect(flagged.text).toContain("当前报名周期结束前");
    expect(flagged.presentation.body).not.toContain(url);
    expect(flagged.text).toContain(url);
    expect(flagged.presentation).toHaveProperty("action", {
      label: "Review and appeal / 核对并申诉",
      url,
    });
  });

  it("keeps an explicit action URL out of HTML prose without losing text-only navigation", () => {
    const copy = linkedEmailCopy({
      subject: "Reset password",
      body: "Reset within 60 minutes.",
      action: { label: "Reset password", url },
    });
    expect(copy.text).toContain(url);
    expect(copy.presentation.body).not.toContain(url);
    expect(copy.presentation.action.url).toBe(url);
  });
});
