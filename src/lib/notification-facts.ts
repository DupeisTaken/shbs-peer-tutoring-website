/** Bounded identity/schedule facts for recorded notifications. Callers explicitly
 * choose public-to-the-recipient fields; never pass reasons, messages or profiles. */
export function notificationLabel(value: string | null | undefined) {
  const label = value?.trim().replace(/\s+/g, " ").slice(0, 80);
  return label?.length ? label : "—";
}

export function notificationList(values: readonly string[]) {
  const names = [...new Set(values.map(notificationLabel))];
  return (
    names.slice(0, 4).join(", ") +
    (names.length > 4 ? ` (+${names.length - 4})` : "")
  );
}

export function notificationSchedule(
  slot: { dayOfWeek: number; startMin: number; endMin: number },
  locale: "en" | "zh",
) {
  const weekdays =
    locale === "en"
      ? [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ]
      : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const clock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${weekdays[slot.dayOfWeek - 1] ?? "—"} ${clock(slot.startMin)}–${clock(slot.endMin)}`;
}

export function notificationCard(color: string, locale: "en" | "zh") {
  return locale === "zh"
    ? color === "RED"
      ? "红卡"
      : "黄卡"
    : color === "RED"
      ? "red card"
      : "yellow card";
}

export function notificationAttendanceStatus(
  status: string,
  locale: "en" | "zh",
) {
  const labels: Record<string, { en: string; zh: string }> = {
    PRESENT: { en: "Present", zh: "出席" },
    TUTOR_ABSENT: { en: "Tutor absent", zh: "辅导伙伴缺席" },
    RESCHEDULED: { en: "Rescheduled", zh: "改期" },
    EXTRA: { en: "Extra session", zh: "额外辅导" },
    EXCUSED_ABSENT: { en: "Excused absence", zh: "请假缺席" },
    UNEXCUSED_ABSENT: { en: "Unexcused absence", zh: "无故缺席" },
  };
  return labels[status]?.[locale] ?? "—";
}

export function notificationInstant(
  date: Date,
  timeZone: string,
  locale: "en" | "zh",
) {
  return `${new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} (${timeZone})`;
}
