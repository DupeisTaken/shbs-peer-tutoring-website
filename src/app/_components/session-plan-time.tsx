"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { hmToMin, minToHm } from "~/lib/time";

export type SessionPlanTime = { date: string; startMin: number };

/** Planned lessons are 45 minutes; actual attendance has an independent duration. */
export function changePlannedClock(
  value: SessionPlanTime,
  clock: string,
  edge: "start" | "end",
): SessionPlanTime {
  if (!/^\d{2}:\d{2}$/.test(clock)) return value;
  if (Number(clock.slice(0, 2)) > 23 || Number(clock.slice(3)) > 59)
    return value;
  const minute = edge === "end" && clock === "00:00" ? 1440 : hmToMin(clock);
  const startMin = edge === "start" ? minute : minute - 45;
  if (startMin < 0 || startMin + 45 > 1440) return value;
  return { ...value, startMin };
}

export function SessionPlanTimeFields({
  value,
  onChange,
  disabled = false,
}: {
  value: SessionPlanTime;
  onChange: (value: SessionPlanTime) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("sessionPlanning");
  const id = useId();
  return (
    <fieldset
      disabled={disabled}
      className="grid min-w-0 gap-4 sm:grid-cols-3"
      aria-describedby={`${id}-duration`}
    >
      <label className="space-y-1">
        <span className="label">{t("date")}</span>
        <input
          className="input"
          type="date"
          required
          value={value.date}
          onChange={(event) => onChange({ ...value, date: event.target.value })}
        />
      </label>
      <label className="space-y-1">
        <span className="label">{t("start")}</span>
        <input
          className="input"
          type="time"
          required
          value={minToHm(value.startMin)}
          onChange={(event) =>
            onChange(changePlannedClock(value, event.target.value, "start"))
          }
        />
      </label>
      <label className="space-y-1">
        <span className="label">{t("end")}</span>
        <input
          className="input"
          type="time"
          required
          value={minToHm((value.startMin + 45) % 1440)}
          onChange={(event) =>
            onChange(changePlannedClock(value, event.target.value, "end"))
          }
        />
      </label>
      <p id={`${id}-duration`} className="muted text-sm sm:col-span-3">
        {t("durationHelp")}
      </p>
      {value.startMin + 45 === 1440 && (
        <p className="muted text-sm sm:col-span-3">{t("nextDayEnd")}</p>
      )}
    </fieldset>
  );
}
