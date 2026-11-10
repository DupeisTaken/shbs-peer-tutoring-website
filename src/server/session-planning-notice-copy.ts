import {
  DEFAULT_EMAIL_LOCALE,
  emailText,
  normalizeEmailLocale,
  type EmailLocale,
} from "~/lib/email-locale";

/** Essential session mail uses maintained localized event copy and a narrow schedule context.
 * Reasons, messages, peer names and participant lists never enter this formatter. */
const descriptions = {
  suggestion: [
    "A tutee suggested a tutoring time. Only a tutor can submit a formal request.",
    "学生建议了一个辅导时间。只有导师可以提交正式请求。",
  ],
  schedule_updated: [
    "The dated timetable was updated from the weekly plan. This does not record anyone's response to a schedule proposal.",
    "单次课表已根据每周计划更新，不代表任何人已回复时间提议。",
  ],
  proposed: [
    "A tutoring time proposal is waiting for your reply.",
    "一项正式辅导时间提议等待您的回复。",
  ],
  countered: [
    "An alternative tutoring time is waiting for your reply. Earlier offers no longer apply.",
    "一个替代辅导时间等待您的回复。此前的提议已失效。",
  ],
  response_accepted: [
    "A participant accepted the current offer. The group moves only when everyone accepts that same offer; review remaining responses in the portal.",
    "一位参与者已接受当前提议。所有人同意同一提议后，小组才会调整时间；请在平台查看其余回复。",
  ],
  response_autoaccepted: [
    "A participant's 24-hour response window after mail-service acceptance ended; their response was automatically accepted. This alone does not confirm a group move.",
    "邮件服务接受通知后，一位参与者的24小时回复期限已结束，其回复已自动接受。这本身不代表小组时间调整已确认。",
  ],
  accepted: [
    "The tutoring time was agreed. Review your confirmed session in the portal.",
    "辅导时间已达成一致。请在平台查看已确认的课程。",
  ],
  autoaccepted: [
    "The tutoring time was automatically accepted when the 24-hour window after mail-service acceptance ended.",
    "邮件服务接受通知后的24小时回复期限已结束，辅导时间已自动接受。",
  ],
  split_requested: [
    "Separate scheduling was requested. The group response timer is paused; the tutor must submit individual requests.",
    "有人申请单独安排时间。小组回复计时已暂停，导师须提交个人请求。",
  ],
  split: [
    "The dated group now has individual scheduling requests. Your weekly pairing is unchanged.",
    "该次小组课程现已分为个人时间请求。每周配对安排保持不变。",
  ],
  cancelled: [
    "This dated tutoring session was cancelled. Weekly recurrence is separate; review the affected session in the portal.",
    "该次辅导课程已取消。每周常规安排单独保留；请在平台查看受影响的课程。",
  ],
  expired: [
    "The schedule request expired before agreement. An existing confirmed session keeps its original time.",
    "时间请求在达成协议前已到期。已确认课程保留原定时间。",
  ],
  deadline_missed: [
    "A response deadline elapsed while scheduling processing was unavailable. The system did not move a session retroactively or infer attendance or absence. Review the original and proposed times with the tutor in the portal.",
    "回复期限在安排处理不可用期间结束。系统没有追溯调整课程，也未推断出勤或缺勤。请采取行动：与导师在平台核对原定时间及提议时间。",
  ],
  stale: [
    "The schedule request is no longer current. Check the portal before acting.",
    "该时间请求已不再有效。请先在平台查看最新状态。",
  ],
} as const;

// Event identities are storage contracts, never recipient-facing subject copy.
const subjects: Record<keyof typeof descriptions, { en: string; zh: string }> =
  {
    suggestion: { en: "Tutoring time suggested", zh: "辅导时间建议" },
    schedule_updated: {
      en: "Tutoring timetable updated",
      zh: "辅导课表已更新",
    },
    proposed: {
      en: "Reply to a tutoring time proposal",
      zh: "请回复辅导时间提议",
    },
    countered: {
      en: "Reply to an alternative tutoring time",
      zh: "请回复替代辅导时间提议",
    },
    response_accepted: {
      en: "A participant agreed to a tutoring time",
      zh: "一位参与者已同意辅导时间",
    },
    response_autoaccepted: {
      en: "Tutoring response accepted automatically",
      zh: "辅导时间回复已自动接受",
    },
    accepted: { en: "Tutoring time agreed", zh: "辅导时间已达成一致" },
    autoaccepted: {
      en: "Tutoring time accepted automatically",
      zh: "辅导时间已自动接受",
    },
    split_requested: {
      en: "Separate tutoring times requested",
      zh: "已申请单独辅导时间",
    },
    split: {
      en: "Individual tutoring scheduling started",
      zh: "已开始个人辅导安排",
    },
    cancelled: { en: "Tutoring session cancelled", zh: "该次辅导已取消" },
    expired: {
      en: "Tutoring schedule request expired",
      zh: "辅导时间请求已到期",
    },
    deadline_missed: {
      en: "Tutoring response deadline needs review",
      zh: "请核对辅导回复期限",
    },
    stale: {
      en: "Tutoring schedule request no longer current",
      zh: "辅导时间请求已失效",
    },
  };

type SafeContext = {
  subjectLabel?: string;
  roomLabel?: string;
  online?: boolean;
  startsAt?: string;
  endsAt?: string;
  originalStartsAt?: string;
  timeZone?: string;
  stage?: "A" | "B" | "C";
  isActionable?: boolean;
  requiresExplicitAcceptance?: boolean;
  outcomeReason?: "MISSED_AUTOMATIC_RESPONSE_WINDOW";
};

export function sessionNoticeContext(input: unknown): SafeContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: SafeContext = {};
  for (const [key, max] of [
    ["subjectLabel", 200],
    ["roomLabel", 120],
  ] as const) {
    const value = source[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      value.length <= max &&
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      result[key] = value.trim();
  }
  if (typeof source.online === "boolean") result.online = source.online;
  for (const key of ["startsAt", "endsAt", "originalStartsAt"] as const) {
    const value = source[key];
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value
    )
      result[key] = value;
  }
  if (typeof source.timeZone === "string") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: source.timeZone });
      result.timeZone = source.timeZone;
    } catch {
      /* Invalid context never invents a local time. */
    }
  }
  if (["A", "B", "C"].includes(String(source.stage)))
    result.stage = source.stage as SafeContext["stage"];
  if (typeof source.isActionable === "boolean")
    result.isActionable = source.isActionable;
  if (typeof source.requiresExplicitAcceptance === "boolean")
    result.requiresExplicitAcceptance = source.requiresExplicitAcceptance;
  if (source.outcomeReason === "MISSED_AUTOMATIC_RESPONSE_WINDOW")
    result.outcomeReason = source.outcomeReason;
  return result;
}

export function sessionPlanningNoticeCopy(
  event: string,
  context: unknown,
  obsolete = false,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
) {
  const language = normalizeEmailLocale(locale);
  const t = (en: string, zh: string) => emailText(language, { en, zh });
  const known = Object.prototype.hasOwnProperty.call(descriptions, event);
  const key = known ? (event as keyof typeof descriptions) : "stale";
  const copy = descriptions[key];
  const safe = sessionNoticeContext(context);
  const lines: string[] = [];
  if (obsolete) {
    lines.push(
      t(
        "This is an earlier update, no longer an actionable offer. Check the current portal state before acting.",
        "此为历史通知，已不再是可操作的提议。请先查看平台当前状态。",
      ),
    );
  }
  lines.push(copy[language === "zh" ? 1 : 0]);
  if (!obsolete && safe.isActionable) {
    lines.push(
      safe.requiresExplicitAcceptance
        ? t(
            "Explicit agreement required: every affected tutor and learner must affirmatively agree to this exact offer before the cutoff. Silence will not accept it. Sign in to respond; replying to this email does not decide.",
            "必须明确同意：每位受影响的辅导伙伴和学习伙伴须在截止前明确同意同一提议。未回复不会视为接受。请登录平台回复；回复本邮件不能作出决定。",
          )
        : t(
            "Respond in the portal. The 24-hour clock starts only after mail-service acceptance; check the exact deadline and short-notice cutoff there. Silence can mean acceptance. Email replies do not decide the offer.",
            "请登录平台回复。邮件服务接受通知后才开始24小时计时；准确期限及临近开课限制以平台为准。未回复可能视为接受，回复本邮件不能作出决定。",
          ),
    );
  }

  const details: string[] = [];
  if (safe.subjectLabel)
    details.push(
      t(
        `Lesson subjects: ${safe.subjectLabel}`,
        `辅导科目：${safe.subjectLabel}`,
      ),
    );
  // Compare calendar dates in the recorded program zone, not UTC or the host zone.
  // Same-day ranges need one date; the metadata block states its timezone once.
  const range = (start: string, end: string | undefined, locale: string) => {
    const date = new Intl.DateTimeFormat(locale, {
      timeZone: safe.timeZone,
      dateStyle: "long",
    });
    const time = new Intl.DateTimeFormat(locale, {
      timeZone: safe.timeZone,
      timeStyle: "short",
    });
    const startDate = date.format(new Date(start));
    const startTime = time.format(new Date(start));
    const separator = locale === "zh" ? " " : ", ";
    if (!end) return `${startDate}${separator}${startTime}`;
    const endDate = date.format(new Date(end));
    const endTime = time.format(new Date(end));
    return startDate === endDate
      ? `${startDate}${separator}${startTime}–${endTime}`
      : `${startDate}${separator}${startTime} – ${endDate}${separator}${endTime}`;
  };
  const confirmed = ["accepted", "autoaccepted", "schedule_updated"].includes(
    key,
  );
  const timeLabel: readonly [string, string] = obsolete
    ? confirmed
      ? ["Earlier confirmed time", "此前确认时间"]
      : ["Earlier proposed time", "此前提议时间"]
    : confirmed
      ? ["Confirmed time", "确认时间"]
      : key === "suggestion"
        ? ["Suggested time", "建议时间"]
        : key === "cancelled"
          ? ["Cancelled session time", "已取消课程时间"]
          : key === "expired" || key === "stale"
            ? ["Earlier proposed time", "此前提议时间"]
            : ["Proposed time", "提议时间"];
  if (safe.startsAt && safe.timeZone) {
    details.push(
      t(
        `${timeLabel[0]}: ${range(safe.startsAt, safe.endsAt, language)}`,
        `${timeLabel[1]}：${range(safe.startsAt, safe.endsAt, language)}`,
      ),
    );
  }
  if (
    safe.originalStartsAt &&
    safe.timeZone &&
    safe.originalStartsAt !== safe.startsAt
  )
    details.push(
      t(
        `Original start: ${range(safe.originalStartsAt, undefined, language)}`,
        `原开始时间：${range(safe.originalStartsAt, undefined, language)}`,
      ),
    );
  if (safe.timeZone && (safe.startsAt || safe.originalStartsAt))
    details.push(t(`Time zone: ${safe.timeZone}`, `时区：${safe.timeZone}`));
  if (safe.online) details.push(t("Location: Online", "地点：线上"));
  else if (safe.roomLabel)
    details.push(t(`Room: ${safe.roomLabel}`, `教室：${safe.roomLabel}`));
  else if (safe.online === false)
    details.push(t("Location: No room specified", "地点：未指定教室"));
  if (details.length) lines.push(details.join("\n"));
  lines.push(
    t(
      "Calendar subscriptions may lag; the portal has the current schedule and response deadline.",
      "日历订阅可能延迟；最新安排和回复期限以平台为准。",
    ),
  );
  return {
    subject: `${obsolete ? t("Earlier tutoring update", "历史辅导通知") : emailText(language, subjects[key])}${safe.subjectLabel ? ` — ${safe.subjectLabel}` : ""}`,
    text: lines.join("\n\n"),
    presentation: {
      locale: language,
      preview: obsolete
        ? t(
            "This is an earlier notice. Check the current schedule before acting.",
            "此为历史通知，请先查看当前安排。",
          )
        : safe.isActionable
          ? safe.requiresExplicitAcceptance
            ? t(
                "Respond on the website; silence will not accept this offer.",
                "请在网站回复，未回复不会视为接受此提议。",
              )
            : t(
                "Respond on the website and check the exact response deadline.",
                "请在网站回复，并核对准确的回复期限。",
              )
          : t(
              "Check the current tutoring schedule and recorded update.",
              "请核对当前辅导安排及已记录的变更。",
            ),
      eyebrow: t("ESSENTIAL SESSION UPDATE", "必要课程通知"),
      action: {
        label: obsolete
          ? t("View current schedule", "查看当前安排")
          : safe.isActionable
            ? t("Respond to proposal", "回复时间提议")
            : t("View session", "查看课程"),
        url: "",
      },
    },
  };
}
