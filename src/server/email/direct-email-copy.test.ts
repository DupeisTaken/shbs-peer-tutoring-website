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

  it("formats each selected language in the program timezone across a UTC date boundary", () => {
    const text = emailDeadline(deadline);
    expect(text).toContain("November 10, 2026");
    expect(text).toContain("7:30 AM");
    expect(text).not.toMatch(/\p{Script=Han}/u);
    const chinese = emailDeadline(deadline, undefined, "zh");
    expect(chinese).toContain("2026年11月10日");
    expect(chinese).toContain("07:30");
    expect(chinese).not.toContain("November");
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
      expect(content).toContain(
        "without changing their password or memberships",
      );
      expect(content).toContain(
        emailDeadline(deadline, { en: "Code expires", zh: "验证码有效期至" }),
      );
    }
    expect(copy.subject).toContain(purpose.en);
    expect(copy.subject).not.toContain(purpose.zh);
    expect(copy.subject).toContain("Verify email · ");
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
      expect(content).toContain("Complete verification by: November 17, 2026");
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
        expect(content).not.toContain(scope.zh);
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
    expect(flagged.presentation.body).not.toContain(url);
    expect(flagged.text).toContain(url);
    expect(flagged.presentation).toHaveProperty("action", {
      label: "Review and appeal",
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

  it.each(["en", "zh"] as const)(
    "keeps every specific delivery in %s with matching HTML/text navigation and code",
    (locale) => {
      const samples = [
        invitationVerificationEmailCopy({
          code: "0012",
          purpose,
          deadline,
          url,
          locale,
        }),
        invitationEmailCopy({ code: "A2B3C", purpose, deadline, url, locale }),
        tutoringSignupEmailCopy({
          code: "0012",
          url,
          deadline,
          legacy: true,
          verificationDue: deadline,
          locale,
        }),
        historyInvitationEmailCopy({
          scope: { en: "Two reviewed records.", zh: "两份已审核记录。" },
          url,
          exact: false,
          locale,
        }),
        signupAppealEmailCopy({
          kind: "INVALID_FLAGGED",
          appealUrl: url,
          locale,
        }),
        signupAppealEmailCopy({ kind: "APPEAL_ACCEPTED", locale }),
        signupAppealEmailCopy({ kind: "APPEAL_REJECTED", locale }),
      ];
      for (const copy of samples) {
        const doc = new DOMParser().parseFromString(
          renderEmail({ brand: "School", ...copy }),
          "text/html",
        );
        expect(doc.documentElement.lang).toBe(locale);
        expect(copy.presentation.locale).toBe(locale);
        expect(doc.querySelector("h1")?.textContent).toBe(copy.subject);
        expect(doc.querySelector(".preheader")?.textContent).toBe(
          copy.presentation.preview,
        );
        expect(copy.presentation.preview).not.toBe(copy.subject);
        expect(copy.presentation.preview).not.toMatch(
          /0012|A2B3C|https:|synthetic/,
        );
        // HTML expresses paragraph and line breaks structurally. Recover only
        // those breaks so the assertion catches omitted, duplicated or reordered
        // prose without expecting literal newlines between DOM text nodes.
        const renderedParagraphs = [...doc.querySelectorAll(".body > p")].map(
          (paragraph) =>
            [...paragraph.childNodes]
              .map((node) =>
                node.nodeName === "BR" ? "\n" : (node.textContent ?? ""),
              )
              .join(""),
        );
        expect(renderedParagraphs).toEqual(
          copy.presentation.body
            .split(/\n\n+/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean),
        );
        expect(copy.text).toContain(copy.presentation.body);
        const action =
          "action" in copy.presentation ? copy.presentation.action : undefined;
        if (action) {
          expect(copy.text).toContain(action.url);
          expect(
            [...doc.querySelectorAll("a")].map((link) => link.href),
          ).toEqual([url, url]);
        }
        if (locale === "en") {
          expect(copy.text).not.toMatch(/\p{Script=Han}/u);
          expect(doc.body.textContent).not.toMatch(/\p{Script=Han}/u);
        } else {
          expect(copy.subject).toMatch(/\p{Script=Han}/u);
          expect(copy.text).not.toMatch(
            /Your email verification code|Enter this code|This reviewed invitation|Your appeal was/,
          );
        }
      }
      const paused = tutoringSignupEmailCopy({
        code: "0012",
        url,
        verificationDue: deadline,
        locale,
      });
      expect(paused.text).toContain(
        locale === "en" ? "Resends do not extend it" : "重发不会延长期限",
      );
    },
  );

  it.each(["en", "zh"] as const)(
    "does not infer %s generic previews from codes, private prose or token links",
    (locale) => {
      const code = codeEmailCopy({
        locale,
        subject: "PRIVATE SUBJECT",
        code: "0012",
        body: "PRIVATE REASON",
        action: { label: "Continue", url },
      });
      const linked = linkedEmailCopy({
        locale,
        subject: "PRIVATE SUBJECT",
        body: "PRIVATE REASON",
        action: { label: "Continue", url },
      });
      for (const copy of [code, linked]) {
        expect(copy.presentation.preview).not.toMatch(
          /PRIVATE|0012|https:|synthetic/,
        );
        expect(copy.presentation.preview).toMatch(
          locale === "en" ? /website/ : /网站/,
        );
      }
      const explicit = codeEmailCopy({
        locale,
        subject: "PRIVATE SUBJECT",
        code: "0012",
        body: "PRIVATE REASON",
        preview:
          locale === "en" ? "Finish mailbox verification." : "请完成邮箱验证。",
      });
      expect(explicit.presentation.preview).toBe(
        locale === "en" ? "Finish mailbox verification." : "请完成邮箱验证。",
      );
    },
  );
});
