import { requestAppealUrl } from "./request-appeal-token";
import { emailOrigin } from "./urls";
import {
  DEFAULT_EMAIL_LOCALE,
  emailText,
  normalizeEmailLocale,
  type EmailLocale,
} from "~/lib/email-locale";

type Notice = {
  id: string;
  createdAt: Date;
  requestKind: string | null;
  requestInvalid: boolean | null;
  requestSubmittedAt: Date | null;
  requestTimeZone: string | null;
  requestReason: string | null;
};

/** Only request-specific mailbox proof permits the free-text reason. Unverified
 * recipients see the request kind and original recorded submission instant only.
 * Missing historical submission time stays unknown, never substituted by row creation. */
export function requestNoticeEmailCopy(
  row: Notice,
  verified: boolean,
  modernAppealUrl?: string | null,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
) {
  const language = normalizeEmailLocale(locale);
  const invalid = !!row.requestInvalid;
  const tutor = row.requestKind === "application";
  const canAppeal =
    invalid && (row.requestKind !== "survey" || !!modernAppealUrl);
  const appealEnglish =
    row.requestKind === "survey"
      ? canAppeal
        ? "Submit an appeal before the current signup period ends. If the appeal is rejected, this request closes and loses its place in line."
        : "This appeal link is unavailable. Sign in to your account or contact the program team."
      : "You can appeal this decision using the button below.";
  const appealChinese =
    row.requestKind === "survey"
      ? canAppeal
        ? "请在当前报名周期结束前提交申诉。如果申诉未通过，本申请将关闭并失去原有排队顺序。"
        : "此申诉链接不可用。请登录你的账号或联系项目团队。"
      : "你可以点击下方按钮对此决定提出申诉。";
  const timeZone = row.requestTimeZone ?? "Asia/Shanghai";
  const time = (locale: string) =>
    row.requestSubmittedAt
      ? `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone }).format(row.requestSubmittedAt)} (${timeZone})`
      : locale === "zh"
        ? "原始提交时间不可用"
        : "Original submission time unavailable";
  const requestTitle = tutor
    ? { en: "Tutor application", zh: "辅导伙伴申请" }
    : row.requestKind === "signup" || row.requestKind === "survey"
      ? { en: "Tutee signup", zh: "学习伙伴报名申请" }
      : { en: "Request", zh: "申请" };
  const englishTitle = invalid
    ? `${requestTitle.en} flagged invalid`
    : `${requestTitle.en} invalid flag cleared`;
  const chineseTitle = invalid
    ? `${requestTitle.zh}已标记为无效`
    : `${requestTitle.zh}无效标记已解除`;
  const english = `${tutor ? "A tutor application" : "A tutee signup request"} using this email address ${invalid ? "was marked invalid and is paused for now. " + appealEnglish : "had its invalid flag cleared and is back in review."}\n\nSubmitted: ${time("en")}`;
  const chinese = `使用此邮箱提交的${tutor ? "辅导伙伴申请" : "学习伙伴报名申请"}${invalid ? "已被标记为无效，目前已暂停处理。" + appealChinese : "的无效标记已解除，已恢复正常审核。"}\n\n提交时间：${time("zh")}`;
  // Free text may already be bilingual. Preserve it once, under the same mailbox-proof gate.
  const reason =
    verified && row.requestReason
      ? emailText(language, {
          en: `\n\nReason: ${row.requestReason}`,
          zh: `\n\n原因：${row.requestReason}`,
        })
      : "";
  const action = canAppeal
    ? {
        label: emailText(language, {
          en: "Appeal this decision",
          zh: "对此决定提出申诉",
        }),
        url: modernAppealUrl ?? requestAppealUrl(row.id, row.createdAt),
      }
    : {
        label: emailText(language, {
          en: "Contact the program",
          zh: "联系项目团队",
        }),
        url: `${emailOrigin()}/privacy#contact`,
      };
  const guidance = canAppeal
    ? {
        en: "Anyone with this link can submit an appeal for this request, so please don't forward it.",
        zh: "持有此链接的人可为此申请提交申诉，请勿转发给他人。",
      }
    : {
        en: "Need help? Reach out to the program team using the contact details on our site.",
        zh: "如需帮助，请通过网站上的联系方式联系项目团队。",
      };
  const body = `${emailText(language, { en: english, zh: chinese })}${reason}\n\n${emailText(language, guidance)}`;
  return {
    subject: emailText(language, { en: englishTitle, zh: chineseTitle }),
    text: `${body}\n\n${action.url}`,
    presentation: {
      locale: language,
      preview: emailText(language, {
        en: invalid
          ? "Check your request status and appeal options."
          : "Your request is back in review.",
        zh: invalid ? "查看你的申请状态及申诉方式。" : "你的申请已恢复正常审核。",
      }),
      body,
      eyebrow: emailText(language, { en: "REQUEST STATUS", zh: "申请状态" }),
      action,
    },
  };
}
