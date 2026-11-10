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
          en: `Your invitation code: ${input.code}.`,
          zh: `邀请码：${input.code}。`,
        })
      : emailText(locale, {
          en: `${verificationLabel.en} is ${input.code}.`,
          zh: `${verificationLabel.zh}：${input.code}。`,
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
                en: "Review this invitation before accepting any added access.",
                zh: "请先核对邀请，再确认新增权限。",
              }
            : {
                en: "Use the code on the website to continue.",
                zh: "请在网站输入验证码以继续。",
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
          en: "Open the website to review the details and next steps.",
          zh: "请打开网站查看详情和后续步骤。",
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
      en: "Verify your mailbox before the code expires, then review any added access.",
      zh: "请在验证码到期前验证邮箱，再核对新增权限。",
    }),
    subject: emailText(locale, {
      en: `Verify email · ${input.purpose.en} invitation`,
      zh: `验证邮箱 · ${input.purpose.zh}邀请`,
    }),
    code: input.code,
    eyebrow: emailText(locale, { en: "EMAIL VERIFICATION", zh: "邮箱验证" }),
    body: [
      emailText(locale, {
        en: `This code proves mailbox ownership so you can review your ${input.purpose.en} invitation; accept any added access separately.`,
        zh: `此验证码仅确认邮箱归属，以便查看${input.purpose.zh}邀请；新增权限仍须另行确认。`,
      }),
      emailDeadline(
        input.deadline,
        { en: "Code expires", zh: "验证码有效期至" },
        locale,
      ),
      emailText(locale, {
        en: "Existing accounts sign in without changing their password or memberships. If you did not request this, ignore this email.",
        zh: "已有账号可登录，密码和身份不变。如非本人申请，请忽略此邮件。",
      }),
    ].join("\n\n"),
    ...(input.url
      ? {
          action: {
            label: emailText(locale, {
              en: "Review invitation",
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
      en: "Review the invitation and its expiry before accepting access.",
      zh: "请先核对邀请及其有效期，再确认权限。",
    }),
    subject: emailText(locale, {
      en: `Invitation to review ${input.purpose.en}`,
      zh: `${input.purpose.zh}邀请`,
    }),
    code: input.code,
    codePurpose: "invitation",
    eyebrow: emailText(locale, { en: "ACCOUNT INVITATION", zh: "账户邀请" }),
    body: [
      emailText(locale, codeGuidance),
      emailDeadline(
        input.deadline,
        { en: "Invitation expires", zh: "邀请有效期至" },
        locale,
      ),
      emailText(locale, {
        en: `Review your invitation for ${input.purpose.en}. Opening it does not grant access or replace existing memberships.`,
        zh: `请审核${input.purpose.zh}邀请。打开邀请不会自动授予权限或替换已有身份。`,
      }),
    ].join("\n\n"),
    action: {
      label: emailText(locale, { en: "Review invitation", zh: "查看邀请" }),
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
          en: "Code and confirmation link expire in 24 hours.",
          zh: "验证码和确认链接 24 小时后失效。",
        })
      : "";
  const requestDeadline = input.verificationDue
    ? `${emailDeadline(input.verificationDue, { en: "Complete verification by", zh: "完成验证截止时间" }, locale)}\n${emailText(
        locale,
        {
          en: "Your request will be permanently disqualified and all assignments released after this deadline. Resends do not extend it.",
          zh: "逾期将永久取消申请资格并解除所有辅导安排，重发不会延长期限。",
        },
      )}`
    : "";
  return codeEmailCopy({
    locale,
    preview: emailText(locale, {
      en: "Verify your email, then finish and confirm your tutoring request.",
      zh: "请验证邮箱，再完成账户确认并确认辅导申请。",
    }),
    subject: emailText(locale, {
      en: "Verify your tutoring signup",
      zh: "验证辅导报名邮箱",
    }),
    code: input.code,
    eyebrow: emailText(locale, { en: "TUTORING SIGNUP", zh: "辅导报名" }),
    body: [
      emailText(locale, {
        en: "Enter this code to verify your tutoring signup email.",
        zh: "输入此验证码以验证辅导报名邮箱。",
      }),
      codeExpiry,
      requestDeadline,
      emailText(locale, {
        en: "Your tutoring request is saved, but signup is not complete. After verification, finish account review and confirm your request. Your original submission priority is kept.",
        zh: "辅导申请已保存，但报名尚未完成。验证邮箱后，请继续完成账户确认并确认申请；原提交优先顺序保留。",
      }),
      ...(input.legacy
        ? [
            emailText(locale, {
              en: "An invitation can sign in your existing account without changing its password; review and accept it to finish. Requesting another confirmation link keeps your submission time.",
              zh: "邀请可登录已有账号且不更改密码；请审核并接受邀请以完成申请。重发确认链接保留原提交时间。",
            }),
          ]
        : []),
      emailText(locale, {
        en: "If you did not submit this request, ignore this email.",
        zh: "如非本人提交，请忽略此邮件。",
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
      en: "Review and claim the listed historical records within seven days.",
      zh: "请在七天内核对并确认关联列出的历史记录。",
    }),
    subject: emailText(locale, {
      en: "Link your historical tutoring records",
      zh: "关联历史辅导记录",
    }),
    eyebrow: emailText(locale, { en: "HISTORICAL RECORDS", zh: "历史记录" }),
    body: [
      emailText(locale, input.scope),
      emailText(locale, {
        en: "Sign in with your verified account, or create a history-only account using a separate email verification code. Review and explicitly claim the listed records.",
        zh: "请使用已验证账号登录，或通过单独的邮箱验证码创建仅供历史访问的账号，然后核对并确认关联列出的记录。",
      }),
      emailText(locale, {
        en: `This reviewed invitation expires in seven days and can be cancelled by staff. It does not enroll you, grant current participation or observer access, or accept policies for you.${input.exact ? "" : " If your old email is unavailable, contact the program team for a reviewed replacement invitation."}`,
        zh: `此已审核邀请七天内有效，管理人员可取消。邀请不会加入当前项目、授予当前参与或观察员权限，也不会代为接受政策。${input.exact ? "" : "如旧邮箱已无法使用，请联系项目团队核实后重新邀请。"}`,
      }),
    ].join("\n\n"),
    action: {
      label: emailText(locale, {
        en: "Review historical records",
        zh: "核对历史记录",
      }),
      url: input.url,
    },
  });
}

export function signupAppealEmailCopy(input: {
  kind: "INVALID_FLAGGED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED";
  appealUrl?: string;
  locale?: EmailLocale;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const copy = {
    INVALID_FLAGGED: {
      subject: {
        en: "Tutoring request paused: appeal available",
        zh: "辅导申请暂停：可提出申诉",
      },
      body: {
        en: "Confirm whether your tutoring request is genuine and explain why it should be reviewed again. Processing stays paused until staff review your appeal. Appeal before the current intake period ends.",
        zh: "请确认您的辅导申请是否真实，并填写重新审核的理由。管理人员审核申诉前，申请处理暂停。请在当前报名周期结束前申诉。",
      },
    },
    APPEAL_ACCEPTED: {
      subject: { en: "Tutoring appeal accepted", zh: "辅导申请申诉已通过" },
      body: {
        en: "Your appeal was accepted. Your request keeps its original priority.",
        zh: "您的申诉已通过，原申请优先顺序保持不变。",
      },
    },
    APPEAL_REJECTED: {
      subject: { en: "Tutoring appeal rejected", zh: "辅导申请申诉已驳回" },
      body: {
        en: "Your appeal was rejected and this request is closed. Submit a fresh request to rejoin the queue with new priority.",
        zh: "您的申诉已驳回，原申请已关闭。重新申请将获得新的排队顺序。",
      },
    },
  }[input.kind];
  const subject = emailText(locale, copy.subject);
  const body = emailText(locale, copy.body);
  const eyebrow = emailText(locale, { en: "REQUEST STATUS", zh: "申请状态" });
  const preview = emailText(locale, {
    en:
      input.kind === "INVALID_FLAGGED"
        ? "Review the appeal instructions before the current signup period ends."
        : input.kind === "APPEAL_ACCEPTED"
          ? "Your original request priority is preserved."
          : "Submit a fresh request if you want to rejoin the queue.",
    zh:
      input.kind === "INVALID_FLAGGED"
        ? "请在当前报名周期结束前查看申诉说明。"
        : input.kind === "APPEAL_ACCEPTED"
          ? "原申请的排队优先顺序保持不变。"
          : "如需重新排队，请提交新的申请。",
  });
  if (input.kind === "INVALID_FLAGGED" && input.appealUrl)
    return linkedEmailCopy({
      locale,
      preview,
      subject,
      body,
      eyebrow,
      action: {
        label: emailText(locale, { en: "Review and appeal", zh: "核对并申诉" }),
        url: input.appealUrl,
      },
    });
  return {
    subject,
    text: body,
    presentation: { locale, preview, body, eyebrow },
  };
}
