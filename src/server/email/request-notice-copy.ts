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
        ? "Appeal during the current signup period. Final rejection closes this request and removes its queue priority."
        : "This appeal link is unavailable. Sign in to the request or contact the program."
      : "You may appeal this decision below.";
  const appealChinese =
    row.requestKind === "survey"
      ? canAppeal
        ? "请在当前报名周期内申诉。最终驳回将关闭本申请并取消排队优先顺序。"
        : "此申诉链接不可用。请登录申请或联系项目团队。"
      : "您可通过下方链接对决定提出申诉。";
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
  const english = `${tutor ? "A tutor application" : "A tutee signup request"} using this email address ${invalid ? "was marked invalid. Processing is paused until authorized management clears the flag. " + appealEnglish + "" : "had its invalid flag cleared. This does not itself approve the request or confirm participation."}\n\nSubmitted: ${time("en")}`;
  const chinese = `使用此邮箱提交的${tutor ? "辅导伙伴申请" : "学习伙伴报名申请"}${invalid ? "已标记为无效。在经授权的管理人员解除标记前，申请处理暂停。" + appealChinese + "" : "的无效标记已解除。这本身不代表申请获批或参与状态已确认。"}\n\n提交时间：${time("zh")}`;
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
        url: `${emailOrigin()}/privacy`,
      };
  const guidance = canAppeal
    ? {
        en: "This link only allows an appeal for this flag. Anyone you forward it to can use that limited link; it does not grant an account or approve participation.",
        zh: "此链接仅允许对此标记提出申诉。收到转发链接的人也能使用此有限权限；链接不会授予账户或批准参与。",
      }
    : {
        en: "Contact the program through its verified contact details if you need help.",
        zh: "如需帮助，请通过项目已确认的联系方式联系团队。",
      };
  const body = `${emailText(language, { en: english, zh: chinese })}${reason}\n\n${emailText(language, guidance)}`;
  return {
    subject: emailText(language, { en: englishTitle, zh: chineseTitle }),
    text: `${body}\n\n${action.url}`,
    presentation: {
      locale: language,
      preview: emailText(language, {
        en: "Review this request status and the available next step.",
        zh: "请核对申请状态及后续处理方式。",
      }),
      body,
      eyebrow: emailText(language, { en: "REQUEST STATUS", zh: "申请状态" }),
      action,
    },
  };
}
