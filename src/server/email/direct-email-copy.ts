import type { EmailPresentation } from "./template";

type Action = NonNullable<EmailPresentation["action"]>;
type Deadline = { at: Date; timeZone: string };

/** Format the saved deadline in both languages with its explicit program zone. */
export function emailDeadline(
  { at, timeZone }: Deadline,
  labels = { en: "Expires", zh: "有效期至" },
) {
  const format = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone,
    }).format(at);
  return `${labels.en}: ${format("en")} (${timeZone}).\n${labels.zh}：${format("zh")}（${timeZone}）。`;
}

/** One escaped HTML body, one full code panel; text-only delivery keeps both code and URL.
 * Explicit copy avoids deleting coincidental code digits from dates or instructions. */
export function codeEmailCopy(input: {
  subject: string;
  code: string;
  body: string;
  codePurpose?: "invitation" | "verification";
  eyebrow?: string;
  action?: Action;
}) {
  const codePurpose = input.codePurpose ?? "verification";
  const verificationLabel = /^\d{4}$/.test(input.code)
    ? "Your email verification code (4 digits) / 邮箱验证码（4 位数字）"
    : "Your email verification code / 邮箱验证码";
  const codeLine =
    codePurpose === "invitation"
      ? `Your invitation code / 邀请码: ${input.code}.`
      : `${verificationLabel} is ${input.code}.`;
  return {
    subject: input.subject,
    text: [codeLine, input.body, input.action?.url]
      .filter(Boolean)
      .join("\n\n"),
    presentation: {
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
}) {
  return {
    subject: input.subject,
    text: `${input.body}\n\n${input.action.url}`,
    presentation: {
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
}) {
  return codeEmailCopy({
    subject: `Verify email · ${input.purpose.en} invitation / 验证邮箱 · ${input.purpose.zh}邀请`,
    code: input.code,
    eyebrow: "EMAIL VERIFICATION / 邮箱验证",
    body: `This code proves mailbox ownership so you can review your ${input.purpose.en} invitation; accept any added access separately.\n此验证码仅确认邮箱归属，以便查看${input.purpose.zh}邀请；新增权限仍须另行确认。\n\n${emailDeadline(input.deadline, { en: "Code expires", zh: "验证码有效期至" })}\n\nExisting accounts sign in without changing their password or memberships. If you did not request this, ignore this email.\n已有账号可登录，密码和身份不变。如非本人申请，请忽略此邮件。`,
    ...(input.url
      ? { action: { label: "Review invitation / 查看邀请", url: input.url } }
      : {}),
  });
}

export function invitationEmailCopy(input: {
  code: string;
  purpose: { en: string; zh: string };
  deadline: Deadline;
  url: string;
}) {
  const codeGuidance = /^(?=.*[A-Z])(?=.*[0-9])[0-9A-Z]{5}$/.test(input.code)
    ? "Enter all 5 letters and numbers. / 请完整输入 5 位字母与数字。"
    : "Previously issued code: enter the complete code as shown. / 此为此前签发的邀请码，请按显示内容完整输入。";
  return codeEmailCopy({
    subject: `Invitation to review ${input.purpose.en} / ${input.purpose.zh}邀请`,
    code: input.code,
    codePurpose: "invitation",
    eyebrow: "ACCOUNT INVITATION / 账户邀请",
    body: `${codeGuidance}\n\n${emailDeadline(input.deadline, { en: "Invitation expires", zh: "邀请有效期至" })}\n\nReview your invitation for ${input.purpose.en}. Opening it does not grant access or replace existing memberships.\n请审核${input.purpose.zh}邀请。打开邀请不会自动授予权限或替换已有身份。`,
    action: { label: "Review invitation / 查看邀请", url: input.url },
  });
}

export function tutoringSignupEmailCopy(input: {
  code: string;
  url: string;
  deadline?: Deadline;
  legacy?: boolean;
  verificationDue?: Deadline;
}) {
  const codeExpiry = input.deadline
    ? emailDeadline(input.deadline, {
        en: "Code expires",
        zh: "验证码有效期至",
      })
    : input.legacy
      ? "Code and confirmation link expire in 24 hours.\n验证码和确认链接 24 小时后失效。"
      : "";
  const requestDeadline = input.verificationDue
    ? `${emailDeadline(input.verificationDue, { en: "Complete verification by", zh: "完成验证截止时间" })}\nYour request will be permanently disqualified and all assignments released after this deadline. Resends do not extend it.\n逾期将永久取消申请资格并解除所有辅导安排，重发不会延长期限。`
    : "";
  return codeEmailCopy({
    subject: "Verify your tutoring signup / 验证辅导报名邮箱",
    code: input.code,
    eyebrow: "TUTORING SIGNUP / 辅导报名",
    body: [
      "Enter this code to verify your tutoring signup email.\n输入此验证码以验证辅导报名邮箱。",
      codeExpiry,
      requestDeadline,
      "Your tutoring request is saved, but signup is not complete. After verification, finish account review and confirm your request. Your original submission priority is kept.\n辅导申请已保存，但报名尚未完成。验证邮箱后，请继续完成账户确认并确认申请；原提交优先顺序保留。",
      ...(input.legacy
        ? [
            "An invitation can sign in your existing account without changing its password; review and accept it to finish. Requesting another confirmation link keeps your submission time.\n邀请可登录已有账号且不更改密码；请审核并接受邀请以完成申请。重发确认链接保留原提交时间。",
          ]
        : []),
      "If you did not submit this request, ignore this email.\n如非本人提交，请忽略此邮件。",
    ]
      .filter(Boolean)
      .join("\n\n"),
    action: { label: "Verify email / 验证邮箱", url: input.url },
  });
}

export function historyInvitationEmailCopy(input: {
  scope: { en: string; zh: string };
  url: string;
  exact: boolean;
}) {
  return linkedEmailCopy({
    subject: "Link your historical tutoring records / 关联历史辅导记录",
    eyebrow: "HISTORICAL RECORDS / 历史记录",
    body: `${input.scope.en}\n${input.scope.zh}\n\nSign in with your verified account, or create a history-only account using a separate email verification code. Review and explicitly claim the listed records.\n请使用已验证账号登录，或通过单独的邮箱验证码创建仅供历史访问的账号，然后核对并确认关联列出的记录。\n\nThis reviewed invitation expires in seven days and can be cancelled by staff. It does not enroll you, grant current participation or observer access, or accept policies for you.${input.exact ? "" : " If your old email is unavailable, contact the program team for a reviewed replacement invitation."}\n此已审核邀请七天内有效，管理人员可取消。邀请不会加入当前项目、授予当前参与或观察员权限，也不会代为接受政策。${input.exact ? "" : "如旧邮箱已无法使用，请联系项目团队核实后重新邀请。"}`,
    action: {
      label: "Review historical records / 核对历史记录",
      url: input.url,
    },
  });
}

export function signupAppealEmailCopy(input: {
  kind: "INVALID_FLAGGED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED";
  appealUrl?: string;
}) {
  const flagged = input.kind === "INVALID_FLAGGED";
  const accepted = input.kind === "APPEAL_ACCEPTED";
  const subject = flagged
    ? "Tutoring request paused: appeal available / 辅导申请暂停：可提出申诉"
    : accepted
      ? "Tutoring appeal accepted / 辅导申请申诉已通过"
      : "Tutoring appeal rejected / 辅导申请申诉已驳回";
  const body = flagged
    ? "Confirm whether your tutoring request is genuine and explain why it should be reviewed again. Processing stays paused until staff review your appeal. Appeal before the current intake period ends.\n请确认您的辅导申请是否真实，并填写重新审核的理由。管理人员审核申诉前，申请处理暂停。请在当前报名周期结束前申诉。"
    : accepted
      ? "Your appeal was accepted. Your request keeps its original priority.\n您的申诉已通过，原申请优先顺序保持不变。"
      : "Your appeal was rejected and this request is closed. Submit a fresh request to rejoin the queue with new priority.\n您的申诉已驳回，原申请已关闭。重新申请将获得新的排队顺序。";
  if (flagged && input.appealUrl)
    return linkedEmailCopy({
      subject,
      body,
      eyebrow: "REQUEST STATUS / 申请状态",
      action: { label: "Review and appeal / 核对并申诉", url: input.appealUrl },
    });
  return {
    subject,
    text: body,
    presentation: { body, eyebrow: "REQUEST STATUS / 申请状态" },
  };
}
