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
    "A tutee suggested a tutoring time. Only a tutor can send a formal request.",
    "学习伙伴建议了一个辅导时间。只有辅导伙伴可以提交正式请求。",
  ],
  schedule_updated: [
    "This session's schedule was updated from your weekly plan. This is an automatic update, not a reply to a reschedule request.",
    "本次辅导安排已根据每周计划更新。这是自动更新，不代表有人回复了改期提议。",
  ],
  proposed: [
    "You have a tutoring time proposal waiting for your reply.",
    "有一项辅导时间提议等你回复。",
  ],
  cancellation_proposed: [
    "You have a request to cancel this extra tutoring session waiting for your reply. The session stays scheduled unless everyone agrees to cancel.",
    "有一项取消本次额外辅导的提议等你回复。在所有相关成员同意前，本次辅导仍按原计划进行。",
  ],
  cancellation_response_accepted: [
    "A participant agreed to cancel this extra tutoring session. It stays scheduled until everyone involved agrees.",
    "一位参与者已同意取消本次额外辅导。在所有相关成员同意同一提议前，本次辅导照常进行。",
  ],
  cancellation_response_autoaccepted: [
    "A participant's 24-hour reply window ended after the notice was sent, so their cancellation reply was automatically accepted. The session stays scheduled until everyone involved agrees.",
    "通知发出后的 24 小时回复期限已过，一位参与者的取消回复已自动接受。在所有相关成员同意前，本次辅导照常进行。",
  ],
  cancellation_rejected: [
    "The cancellation request was declined, so this extra tutoring session remains scheduled at its confirmed time.",
    "取消提议已被拒绝，本次额外辅导仍按原确认时间进行。",
  ],
  countered: [
    "An alternative tutoring time is waiting for your reply. Earlier proposals no longer apply.",
    "有一个替代辅导时间等你回复，此前的提议已失效。",
  ],
  response_accepted: [
    "A participant accepted the current proposal. Group sessions move only when everyone accepts the same time—check remaining replies on the website.",
    "一位参与者已接受当前提议。小组辅导需所有成员同意同一时间才会调整，请在网站查看其余回复。",
  ],
  response_autoaccepted: [
    "A participant's 24-hour reply window ended after the notice was sent, so their reply was automatically accepted. The group time is not confirmed until everyone agrees.",
    "通知发出后的 24 小时回复期限已过，一位参与者的回复已自动接受。小组时间需所有成员同意后才会确认。",
  ],
  accepted: [
    "The tutoring time is confirmed. View your updated session on the website.",
    "辅导时间已确认，请在网站查看更新后的安排。",
  ],
  autoaccepted: [
    "The 24-hour reply window ended after the notice was sent, so this tutoring time was automatically accepted.",
    "通知发出后的 24 小时回复期限已过，本次辅导时间已自动接受。",
  ],
  split_requested: [
    "Separate times were requested for this group session. The group reply deadline is paused while the tutor sends individual requests.",
    "有人申请为本次小组辅导单独安排时间。小组回复倒计时已暂停，辅导伙伴需分别提交个人时间请求。",
  ],
  split: [
    "This group session has been split into individual scheduling requests. Your regular weekly pairing is unchanged.",
    "本次小组辅导已拆分为个人时间请求，你的每周常规配对不受影响。",
  ],
  cancelled: [
    "This tutoring session was cancelled. Your regular weekly schedule is unchanged—view the details on the website.",
    "本次辅导已取消，你的每周常规安排不受影响。请在网站查看详情。",
  ],
  expired: [
    "This schedule request expired before everyone agreed. Any confirmed session keeps its original time.",
    "时间请求在达成一致前已过期，已确认的辅导保留原定时间。",
  ],
  deadline_missed: [
    "A reply deadline passed while automatic scheduling was temporarily unavailable. No session was moved, and no attendance or absence was recorded. Check the original and proposed times on the website and confirm with your tutoring partner.",
    "自动排课暂时不可用期间，有一项回复期限已过。系统未更改辅导时间，也未记录出勤或缺勤。请在网站核对原定与提议时间，并与对方确认。",
  ],
  stale: [
    "This schedule request is no longer active. Check your current schedule on the website.",
    "该时间请求已失效，请在网站查看最新辅导安排。",
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
    cancellation_proposed: {
      en: "Reply to an extra-session cancellation",
      zh: "请回复额外辅导取消提议",
    },
    cancellation_response_accepted: {
      en: "A participant agreed to cancel an extra session",
      zh: "一位参与者已同意取消额外辅导",
    },
    cancellation_response_autoaccepted: {
      en: "Cancellation response accepted automatically",
      zh: "取消回复已自动接受",
    },
    cancellation_rejected: {
      en: "Extra-session cancellation declined",
      zh: "额外辅导取消提议已被拒绝",
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
  kind?: "CANCEL";
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
  outcomeReason?: "MISSED_AUTOMATIC_RESPONSE_WINDOW" | "TUTORING_PAUSE";
  pauseStartDate?: string;
  pauseEndDate?: string;
  recipientRole?: "tutor" | "tutee";
};

function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function sessionNoticeContext(input: unknown): SafeContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: SafeContext = {};
  if (source.kind === "CANCEL") result.kind = "CANCEL";
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
  // A pause notice carries date-only policy facts, never free-text reasons or
  // participant names. Admit the complete inclusive range together.
  if (
    source.outcomeReason === "TUTORING_PAUSE" &&
    isCalendarDate(source.pauseStartDate) &&
    isCalendarDate(source.pauseEndDate) &&
    source.pauseEndDate >= source.pauseStartDate
  ) {
    result.outcomeReason = source.outcomeReason;
    result.pauseStartDate = source.pauseStartDate;
    result.pauseEndDate = source.pauseEndDate;
    if (source.recipientRole === "tutor" || source.recipientRole === "tutee")
      result.recipientRole = source.recipientRole;
  }
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
  const safe = sessionNoticeContext(context);
  const cancellationEvent =
    safe.kind === "CANCEL" &&
    ["proposed", "response_accepted", "response_autoaccepted"].includes(event)
      ? `cancellation_${event}`
      : event;
  const known = Object.prototype.hasOwnProperty.call(
    descriptions,
    cancellationEvent,
  );
  const key = known
    ? (cancellationEvent as keyof typeof descriptions)
    : "stale";
  const copy = descriptions[key];
  const pauseRange =
    key === "cancelled" &&
    safe.outcomeReason === "TUTORING_PAUSE" &&
    safe.pauseStartDate &&
    safe.pauseEndDate
      ? { start: safe.pauseStartDate, end: safe.pauseEndDate }
      : null;
  const lines: string[] = [];
  if (obsolete) {
    lines.push(
      t(
        "This earlier notice is out of date—this offer is no longer open. Check your current schedule on the website for the latest status.",
        "这条早期通知已过期，原提议不再有效。请在网站查看当前最新的辅导安排。",
      ),
    );
  }
  if (pauseRange) {
    // Policy dates are labels: a recipient's timezone must not shift either end.
    const date = new Intl.DateTimeFormat(language, {
      dateStyle: "long",
      timeZone: "UTC",
    });
    const start = date.format(new Date(`${pauseRange.start}T00:00:00Z`));
    const end = date.format(new Date(`${pauseRange.end}T00:00:00Z`));
    lines.push(
      pauseRange.start === pauseRange.end
        ? t(
            `Regular tutoring is paused on ${start}, so your regular session has been cancelled.`,
            `${start}暂停常规辅导，你当天已安排的常规辅导已取消。`,
          )
        : t(
            `Regular tutoring is paused from ${start} through ${end} (inclusive), so your regular session has been cancelled.`,
            `${start}至${end}暂停常规辅导（含首尾两日），你在此期间的常规辅导已取消。`,
          ),
    );
    lines.push(
      t(
        "Confirmed extra sessions and agreed rescheduled sessions still go ahead.",
        "已确认的额外辅导和已同意改期的辅导照常进行。",
      ),
    );
    lines.push(
      safe.recipientRole === "tutor"
        ? t(
            "If needed, you can coordinate with your tutee to schedule an extra session.",
            "如有需要，你可以和学习伙伴商量安排额外辅导。",
          )
        : safe.recipientRole === "tutee"
          ? t(
              "If needed, you can coordinate with your tutor to schedule an extra session.",
              "如有需要，你可以和辅导伙伴商量安排额外辅导。",
            )
          : t(
              "If needed, you can coordinate with your tutoring partner to schedule an extra session.",
              "如有需要，双方可以商量安排额外辅导。",
            ),
    );
  } else if (!obsolete) {
    lines.push(copy[language === "zh" ? 1 : 0]);
  }
  if (!obsolete && safe.isActionable) {
    lines.push(
      safe.requiresExplicitAcceptance
        ? t(
            "Explicit agreement required: every affected tutor and tutee must actively accept this proposal on the website before the deadline—no response will not accept it. Reply on the website (email replies won't be recorded).",
            "需要明确同意：所有相关的辅导伙伴和学习伙伴都须在截止前登录网站同意同一提议，未回复不会视为接受。请在网站回复（直接回复本邮件无效）。",
          )
        : t(
            "Reply on the website and check the exact deadline and short-notice cutoff there (the 24-hour window starts when the notice is sent). If you don't reply in time, it may be accepted automatically. Replying to this email won't be recorded.",
            "请登录网站回复，并以网站显示的准确截止时间和临近开课限制为准（24 小时回复期自通知发出起算）。若未按时回复，可能会视为自动接受。直接回复本邮件无效。",
          ),
    );
  }

  const details: string[] = [];
  if (safe.subjectLabel)
    details.push(
      t(
        `Subjects: ${safe.subjectLabel}`,
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
    : safe.kind === "CANCEL" && key !== "cancelled"
      ? ["Session time", "辅导时间"]
      : confirmed
        ? ["Confirmed time", "确认时间"]
        : key === "suggestion"
          ? ["Suggested time", "建议时间"]
          : key === "cancelled"
            ? ["Cancelled session time", "已取消辅导时间"]
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
    pauseRange
      ? t(
          "Subscribed calendars may lag; check the website for your current confirmed sessions.",
          "订阅日历可能同步较慢，当前已确认的辅导安排请以网站为准。",
        )
      : t(
          "Subscribed calendars may lag; check the website for the latest schedule and deadlines.",
          "订阅日历可能同步较慢，最新安排和回复截止时间请以网站为准。",
        ),
  );
  return {
    subject: `${obsolete ? t("Earlier tutoring update", "历史辅导通知") : pauseRange ? t("Tutoring pause — regular session cancelled", "常规辅导暂停：本次安排已取消") : emailText(language, subjects[key])}${safe.subjectLabel ? ` — ${safe.subjectLabel}` : ""}`,
    text: lines.join("\n\n"),
    presentation: {
      locale: language,
      preview: obsolete
        ? t(
            "This notice is out of date. Check your current schedule on the website.",
            "此通知已过期，请在网站查看当前辅导安排。",
          )
        : safe.isActionable
          ? safe.requiresExplicitAcceptance
            ? t(
                "Reply on the website; no response will not accept this proposal.",
                "请在网站回复，未回复不会视为接受此提议。",
              )
            : t(
                "Reply on the website and check the exact response deadline.",
                "请在网站回复，并核对准确的回复截止时间。",
              )
          : t(
              "Check your current tutoring schedule on the website.",
              "请在网站查看当前的辅导安排。",
            ),
      eyebrow: t("SESSION UPDATE", "辅导安排通知"),
      action: {
        label:
          obsolete || pauseRange
            ? t("View current schedule", "查看当前安排")
            : safe.isActionable
              ? safe.kind === "CANCEL"
                ? t("Respond to cancellation", "回复取消提议")
                : t("Respond to proposal", "回复时间提议")
              : t("View session", "查看辅导安排"),
        url: "",
      },
    },
  };
}
