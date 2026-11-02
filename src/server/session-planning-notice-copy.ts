/** Essential session mail uses fixed bilingual event copy and a narrow schedule context.
 * Reasons, messages, peer names and participant lists never enter this formatter. */
const descriptions = {
  suggestion: [
    "A tutee suggested a tutoring time. Only a tutor can submit a formal request.",
    "学生建议了一个辅导时间。只有导师可以提交正式请求。",
  ],
  schedule_updated: [
    "The confirmed dated schedule was refreshed from the program's weekly plan. This is a timetable update; it does not record a participant's negotiation response.",
    "已确认的单次课程安排已根据项目每周计划更新。这是课程表更新，并不代表记录了参与者的协商回复。",
  ],
  proposed: [
    "A formal tutoring schedule proposal is ready for review.",
    "一项正式辅导时间提议等待审核。",
  ],
  countered: [
    "An alternative tutoring time is ready for review. Earlier offers no longer apply.",
    "一个替代辅导时间等待审核。此前的提议已失效。",
  ],
  response_accepted: [
    "A participant accepted the current offer. A group moves only after everyone agrees to that same offer; check the portal for remaining responses.",
    "一位参与者接受了当前提议。只有所有人同意同一提议后，小组才会调整时间；请在平台查看其余回复。",
  ],
  response_autoaccepted: [
    "A participant's delivered 24-hour response window ended and their response was automatically accepted. This does not by itself confirm a group move.",
    "一位参与者收到通知后的24小时回复期限已结束，其回复已自动接受。这本身并不代表小组时间调整已确认。",
  ],
  accepted: [
    "The tutoring schedule agreement has been recorded. Check the portal for your confirmed session.",
    "辅导时间协议已记录。请在平台查看您已确认的课程。",
  ],
  autoaccepted: [
    "The tutoring schedule was automatically accepted after the delivered notice's 24-hour response window.",
    "辅导时间在通知送达后的24小时回复期限结束后已自动接受。",
  ],
  split_requested: [
    "Separate scheduling was requested. The group response timer is suspended; the tutor must formalize individual requests.",
    "有人申请单独安排时间。小组回复计时已暂停，导师须正式提交个人请求。",
  ],
  split: [
    "The dated group now has individual scheduling requests. Your weekly pairing is unchanged.",
    "该次小组课程现已分为个人时间请求。每周配对安排保持不变。",
  ],
  cancelled: [
    "This dated tutoring commitment was cancelled. Check the portal for the affected session; weekly recurrence is separate.",
    "该次辅导课程已取消。请在平台查看受影响的课程；每周常规安排单独保留。",
  ],
  expired: [
    "The schedule request expired before agreement. An existing confirmed session keeps its original time.",
    "时间请求在达成协议前已到期。已确认课程保留原定时间。",
  ],
  deadline_missed: [
    "A delivered response deadline elapsed while scheduling processing was unavailable. The system did not move a session retroactively. Action is required: review the original session and proposed time in the portal with the tutor; no attendance or absence was inferred.",
    "已送达通知的回复期限在安排处理不可用期间结束。系统没有追溯调整课程。请采取行动：与导师在平台核对原定课程及提议时间；系统未推断出勤或缺勤。",
  ],
  stale: [
    "The schedule request is no longer current. Check the portal before acting.",
    "该时间请求已不再有效。请先在平台查看最新状态。",
  ],
} as const;

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
  if (source.outcomeReason === "MISSED_AUTOMATIC_RESPONSE_WINDOW")
    result.outcomeReason = source.outcomeReason;
  return result;
}

export function sessionPlanningNoticeCopy(
  event: string,
  context: unknown,
  obsolete = false,
) {
  const known = Object.prototype.hasOwnProperty.call(descriptions, event);
  const copy =
    descriptions[known ? (event as keyof typeof descriptions) : "stale"];
  const safe = sessionNoticeContext(context);
  const lines: string[] = [copy[0], copy[1]];
  if (safe.subjectLabel)
    lines.push(`Lesson subjects / 辅导科目: ${safe.subjectLabel}`);
  const time = (value: string) =>
    `${new Intl.DateTimeFormat("en", {
      timeZone: safe.timeZone,
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(value))} (${safe.timeZone})`;
  if (safe.startsAt && safe.timeZone) {
    lines.push(
      `Time / 时间: ${time(safe.startsAt)}${safe.endsAt ? ` — ${time(safe.endsAt)}` : ""}`,
    );
  }
  if (safe.originalStartsAt && safe.timeZone)
    lines.push(`Original start / 原开始时间: ${time(safe.originalStartsAt)}`);
  if (safe.online) lines.push("Location / 地点: Online / 线上");
  else if (safe.roomLabel) lines.push(`Room / 教室: ${safe.roomLabel}`);
  else if (safe.online === false)
    lines.push("Location / 地点: No room specified / 未指定教室");
  if (safe.stage) lines.push(`Stage / 阶段: ${safe.stage}`);
  if (obsolete) {
    lines.push(
      "This notice records an earlier transition. It is no longer an actionable offer; check the current portal state.",
      "此通知记录了较早的变更，已不再是可操作的提议；请查看平台当前状态。",
    );
  } else if (safe.isActionable) {
    lines.push(
      "Action required: sign in to review and respond. The 24-hour clock starts only after this essential notice is accepted by the mail service. The exact deadline and short-notice cutoff appear in the portal. Silence can mean acceptance; do not reply to this email to decide.",
      "请登录查看并回复。24小时计时仅在邮件服务接受此必要通知后开始。准确期限及临近开课限制显示在平台上。未回复可能视为接受；回复本邮件不能作出决定。",
    );
  }
  lines.push(
    "Calendar subscriptions can update late. Use the portal for the current schedule and response deadline.",
    "日历订阅可能延迟更新。请以平台上的最新安排和回复期限为准。",
  );
  return {
    subject: `${obsolete ? "Earlier update / 历史通知: " : ""}Tutoring schedule / 辅导安排: ${known ? event : "update"}${safe.subjectLabel ? ` — ${safe.subjectLabel}` : ""}`,
    text: lines.join("\n\n"),
    presentation: {
      eyebrow: "ESSENTIAL SESSION UPDATE",
      action: { label: "Review session / 查看课程", url: "" },
    },
  };
}
