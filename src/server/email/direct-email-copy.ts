import {
  DEFAULT_EMAIL_LOCALE,
  emailText,
  normalizeEmailLocale,
  type EmailLocale,
} from "~/lib/email-locale";
import type { EmailPresentation } from "./template";

type Action = NonNullable<EmailPresentation["action"]>;
type Deadline = { at: Date; timeZone: string };

/** Format the saved deadline in the delivery language and explicit program zone. */
export function emailDeadline(
  { at, timeZone }: Deadline,
  labels = { en: "Expires", zh: "有效期至" },
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
) {
  const language = normalizeEmailLocale(locale);
  const time = new Intl.DateTimeFormat(language, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(at);
  return emailText(language, {
    en: `${labels.en}: ${time} (${timeZone}).`,
    zh: `${labels.zh}：${time}（${timeZone}）。`,
  });
}

/** One escaped HTML body, one full code panel; text-only delivery keeps code and URL.
 * Callers provide maintained localized prose, never an assembled bilingual string to parse. */
export function codeEmailCopy(input: {
  subject: string;
  code: string;
  body: string;
  locale?: EmailLocale;
  codePurpose?: "invitation" | "verification";
  eyebrow?: string;
  action?: Action;
  preview?: string;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const codePurpose = input.codePurpose ?? "verification";
  const verificationLabel = /^\d{4}$/.test(input.code)
    ? {
        en: "Your email verification code (4 digits)",
        zh: "邮箱验证码（4 位数字）",
      }
    : { en: "Your email verification code", zh: "邮箱验证码" };
  const codeLine =
    codePurpose === "invitation"
      ? emailText(locale, {
          en: `Invitation code: ${input.code}`,
          zh: `邀请码：${input.code}`,
        })
      : emailText(locale, {
          en: `${verificationLabel.en} is ${input.code}.`,
          zh: `${verificationLabel.zh}：${input.code}`,
        });
  return {
    subject: input.subject,
    text: [codeLine, input.body, input.action?.url]
      .filter(Boolean)
      .join("\n\n"),
    presentation: {
      locale,
      preview:
        input.preview ??
        emailText(
          locale,
          codePurpose === "invitation"
            ? {
                en: "Your invitation code is inside. Open the website to review it.",
                zh: "内含你的邀请码，前往网站查看即可继续。",
              }
            : {
                en: "Enter the verification code on the website to continue.",
                zh: "在网站输入验证码即可继续。",
              },
        ),
      code: input.code,
      codePurpose,
      body: input.body,
      ...(input.eyebrow ? { eyebrow: input.eyebrow } : {}),
      ...(input.action ? { action: input.action } : {}),
    },
  };
}

export function linkedEmailCopy(input: {
  subject: string;
  body: string;
  action: Action;
  eyebrow?: string;
  locale?: EmailLocale;
  preview?: string;
}) {
  const locale = normalizeEmailLocale(input.locale);
  return {
    subject: input.subject,
    text: `${input.body}\n\n${input.action.url}`,
    presentation: {
      locale,
      preview:
        input.preview ??
        emailText(locale, {
          en: "Open the link on the website to continue.",
          zh: "打开网站链接以继续。",
        }),
      body: input.body,
      action: input.action,
      ...(input.eyebrow ? { eyebrow: input.eyebrow } : {}),
    },
  };
}

export function invitationVerificationEmailCopy(input: {
  code: string;
  purpose: { en: string; zh: string };
  deadline: Deadline;
  url?: string;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  return codeEmailCopy({
    locale,
    preview: emailText(locale, {
      en: "Enter this code to verify your email and view your invitation.",
      zh: "输入验证码验证邮箱，即可查看你的邀请。",
    }),
    subject: emailText(locale, {
      en: `Verify your email · ${input.purpose.en} invitation`,
      zh: `验证邮箱 · ${input.purpose.zh}邀请`,
    }),
    code: input.code,
    eyebrow: emailText(locale, { en: "EMAIL VERIFICATION", zh: "邮箱验证" }),
    body: [
      emailText(locale, {
        en: `Enter this code to verify your email and view your ${input.purpose.en} invitation. You'll confirm any changes on the next screen.`,
        zh: `输入此验证码以验证邮箱并查看你的${input.purpose.zh}邀请，所有更改都需你确认后才会生效。`,
      }),
      emailDeadline(
        input.deadline,
        { en: "Code expires", zh: "验证码有效期至" },
        locale,
      ),
      emailText(locale, {
        en: "Already have an account? You can sign in with your current password and keep your existing roles. If you didn't request this, ignore this email.",
        zh: "已有账号可直接用原密码登录，现有身份不变。如非本人申请，忽略此邮件即可。",
      }),
    ].join("\n\n"),
    ...(input.url
      ? {
          action: {
            label: emailText(locale, {
              en: "Open invitation",
              zh: "查看邀请",
            }),
            url: input.url,
          },
        }
      : {}),
  });
}

export function invitationEmailCopy(input: {
  code: string;
  purpose: { en: string; zh: string };
  deadline: Deadline;
  url: string;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const codeGuidance = /^(?=.*[A-Z])(?=.*[0-9])[0-9A-Z]{5}$/.test(input.code)
    ? {
        en: "Enter all 5 letters and numbers.",
        zh: "请完整输入 5 位字母与数字。",
      }
    : {
        en: "Previously issued code: enter the complete code as shown.",
        zh: "此为此前签发的邀请码，请按显示内容完整输入。",
      };
  return codeEmailCopy({
    locale,
    preview: emailText(locale, {
      en: "Open the link or use your invitation code on the website to continue.",
      zh: "打开链接或在网站输入邀请码即可继续。",
    }),
    subject: emailText(locale, {
      en: `Your ${input.purpose.en} invitation`,
      zh: `你的${input.purpose.zh}邀请`,
    }),
    code: input.code,
    codePurpose: "invitation",
    eyebrow: emailText(locale, { en: "ACCOUNT INVITATION", zh: "账号邀请" }),
    body: [
      emailText(locale, {
        en: `Here is your ${input.purpose.en} invitation. Open it on the website to review the details before confirming—your existing roles won't be replaced.`,
        zh: `这是你的${input.purpose.zh}邀请。打开网站查看详情后再决定是否确认，你现有的身份不会被替换。`,
      }),
      emailText(locale, codeGuidance),
      emailDeadline(
        input.deadline,
        { en: "Invitation expires", zh: "邀请有效期至" },
        locale,
      ),
    ].join("\n\n"),
    action: {
      label: emailText(locale, { en: "Open invitation", zh: "查看邀请" }),
      url: input.url,
    },
  });
}

export function tutoringSignupEmailCopy(input: {
  code: string;
  url: string;
  deadline?: Deadline;
  legacy?: boolean;
  verificationDue?: Deadline;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const codeExpiry = input.deadline
    ? emailDeadline(
        input.deadline,
        { en: "Code expires", zh: "验证码有效期至" },
        locale,
      )
    : input.legacy
      ? emailText(locale, {
          en: "This code and link expire in 24 hours.",
          zh: "验证码和链接 24 小时内有效。",
        })
      : "";
  const requestDeadline = input.verificationDue
    ? `${emailDeadline(input.verificationDue, { en: "Verification deadline", zh: "验证截止时间" }, locale)}\n${emailText(
        locale,
        {
          en: "Finish before this deadline—afterward your request will be permanently closed and any assignments released. Requesting a new link does not extend it.",
          zh: "请在此时间前完成验证；逾期将永久取消申请资格并解除已分配的辅导安排，重新发送不会延长期限。",
        },
      )}`
    : "";
  return codeEmailCopy({
    locale,
    preview: emailText(locale, {
      en: "Your request is saved—verify your email and confirm your signup to finish.",
      zh: "你的辅导申请已保存，验证邮箱并确认即可完成报名。",
    }),
    subject: emailText(locale, {
      en: "Verify your tutoring signup",
      zh: "验证辅导报名邮箱",
    }),
    code: input.code,
    eyebrow: emailText(locale, { en: "TUTORING SIGNUP", zh: "辅导报名" }),
    body: [
      emailText(locale, {
        en: "Your tutoring request is saved, but your signup is not complete yet. Enter this code (or use the button below) to verify your email, then sign in or set up your account to confirm. Your original place in line is kept.",
        zh: "你的辅导申请已保存，但报名尚未完成。输入此验证码（或点击下方按钮）验证邮箱，然后登录或设置账号并确认申请。原本的排队顺序也会保留。",
      }),
      codeExpiry,
      requestDeadline,
      ...(input.legacy
        ? [
            emailText(locale, {
              en: "Already have an account? Signing in through the invitation keeps your current password, and requesting another link keeps your original submission time.",
              zh: "已有账号通过邀请登录不会更改原密码；重新获取链接也会保留原提交时间。",
            }),
          ]
        : []),
      emailText(locale, {
        en: "Didn't submit a tutoring request? You can safely ignore this email.",
        zh: "如果你没有提交过辅导申请，忽略此邮件即可。",
      }),
    ]
      .filter(Boolean)
      .join("\n\n"),
    action: {
      label: emailText(locale, { en: "Verify email", zh: "验证邮箱" }),
      url: input.url,
    },
  });
}

export function historyInvitationEmailCopy(input: {
  scope: { en: string; zh: string };
  url: string;
  exact: boolean;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  return linkedEmailCopy({
    locale,
    preview: emailText(locale, {
      en: "Review and link your past tutoring records within 7 days.",
      zh: "请在 7 天内查看并关联你的往期辅导记录。",
    }),
    subject: emailText(locale, {
      en: "Link your historical tutoring records",
      zh: "关联历史辅导记录",
    }),
    eyebrow: emailText(locale, { en: "HISTORICAL RECORDS", zh: "历史记录" }),
    body: [
      emailText(locale, input.scope),
      emailText(locale, {
        en: "Sign in to your account—or create a history-only account with an email verification code—to view and claim these records.",
        zh: "登录你的账号（或通过邮箱验证码创建仅查看历史记录的账号），即可核对并关联这些记录。",
      }),
      emailText(locale, {
        en: `This link expires in 7 days and only adds your past records without changing your current participation.${input.exact ? "" : " If your old email is no longer available, contact the program team for a new link."}`,
        zh: `此链接 7 天内有效，仅用于关联历史记录，不会改变你当前的参与状态。${input.exact ? "" : "如果旧邮箱已无法使用，请联系项目团队重新发送链接。"}`,
      }),
    ].join("\n\n"),
    action: {
      label: emailText(locale, {
        en: "View historical records",
        zh: "查看历史记录",
      }),
      url: input.url,
    },
  });
}

export function signupAppealEmailCopy(input: {
  kind: "INVALID_FLAGGED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED";
  appealUrl?: string;
  actionUrl?: string;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const copy = {
    INVALID_FLAGGED: {
      subject: {
        en: "Tutoring request paused: appeal available",
        zh: "辅导申请已暂停：可以申诉",
      },
      body: {
        en: "Your tutoring request was flagged as invalid. Processing is paused until this is resolved. Submit an appeal before the current signup period ends to confirm your request is genuine.",
        zh: "你的辅导申请被标记为无效，申请处理暂停。请在当前报名周期结束前提交申诉，说明你的申请真实有效。",
      },
    },
    APPEAL_ACCEPTED: {
      subject: { en: "Tutoring appeal accepted", zh: "辅导申请申诉已通过" },
      body: {
        en: "Your appeal was accepted. Your tutoring request is active again with its original place in line.",
        zh: "你的申诉已通过，辅导申请已恢复正常处理，原本的排队顺序保持不变。",
      },
    },
    APPEAL_REJECTED: {
      subject: { en: "Tutoring appeal rejected", zh: "辅导申请申诉未通过" },
      body: {
        en: "Your appeal was rejected and this request has been closed. You can submit a new request to rejoin the queue.",
        zh: "你的申诉未通过，原申请已关闭。如需继续申请，可以重新提交一份新的报名。",
      },
    },
  }[input.kind];
  const subject = emailText(locale, copy.subject);
  const body = emailText(locale, copy.body);
  const eyebrow = emailText(locale, { en: "REQUEST STATUS", zh: "申请状态" });
  const preview = emailText(locale, {
    en:
      input.kind === "INVALID_FLAGGED"
        ? "Submit an appeal before the current signup period ends."
        : input.kind === "APPEAL_ACCEPTED"
          ? "Your tutoring request is back in line with its original priority."
          : "This request is closed. Submit a new request if you still need tutoring.",
    zh:
      input.kind === "INVALID_FLAGGED"
        ? "请在当前报名周期结束前提交申诉。"
        : input.kind === "APPEAL_ACCEPTED"
          ? "你的辅导申请已恢复，原排队顺序不变。"
          : "原申请已关闭，如需辅导可重新报名。",
  });
  if (input.kind === "INVALID_FLAGGED" && input.appealUrl)
    return linkedEmailCopy({
      locale,
      preview,
      subject,
      body,
      eyebrow,
      action: {
        label: emailText(locale, { en: "Submit an appeal", zh: "提交申诉" }),
        url: input.appealUrl,
      },
    });
  if (input.kind === "APPEAL_ACCEPTED" && input.actionUrl)
    return linkedEmailCopy({
      locale,
      preview,
      subject,
      body,
      eyebrow,
      action: {
        label: emailText(locale, { en: "View your request", zh: "查看你的申请" }),
        url: input.actionUrl,
      },
    });
  if (input.kind === "APPEAL_REJECTED" && input.actionUrl)
    return linkedEmailCopy({
      locale,
      preview,
      subject,
      body,
      eyebrow,
      action: {
        label: emailText(locale, { en: "Submit a new request", zh: "重新报名" }),
        url: input.actionUrl,
      },
    });
  return {
    subject,
    text: body,
    presentation: { locale, preview, body, eyebrow },
  };
}
