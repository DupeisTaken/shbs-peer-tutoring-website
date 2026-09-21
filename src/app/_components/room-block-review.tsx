"use client";

import { useFormatter, useTranslations } from "next-intl";
import { minToHm } from "~/lib/time";
import type { roomBlockReview, ReviewPeriod } from "~/lib/room-block-review";

export function RoomBlockReview({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof roomBlockReview>>;
}) {
  const t = useTranslations("admin.rooms");
  const format = useFormatter();
  const renderPeriod = (value: ReviewPeriod | null) =>
    value ? (
      <>
        <p className="font-medium text-slate-900">
          {format.dateTime(new Date(Date.UTC(2026, 0, 4 + value.dayOfWeek)), {
            weekday: "long",
            timeZone: "UTC",
          })}{" "}
          <span className="whitespace-nowrap tabular-nums">
            {minToHm(value.startMin)}–{minToHm(value.endMin)}
          </span>
        </p>
        <p className="mt-1 break-words whitespace-pre-wrap text-slate-600">
          {value.reason ?? t("noReason")}
        </p>
      </>
    ) : (
      <p className="text-slate-600">{t("reviewUnavailable")}</p>
    );
  return (
    <section
      aria-label={t("reviewSummary")}
      className="space-y-4 rounded-lg bg-slate-50 p-4 text-sm"
    >
      <div>
        <h4 className="text-xs font-medium text-slate-500">
          {t("reviewRoom")}
        </h4>
        <p className="mt-1 font-semibold break-words text-slate-900">
          {summary.roomName ?? t("reviewRoomUnavailable")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {summary.kind !== "create" && (
          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-medium text-slate-500">
              {summary.kind === "delete"
                ? t("reviewRemove")
                : t("reviewCurrent")}
            </h4>
            {renderPeriod(summary.before)}
          </div>
        )}
        {summary.kind !== "delete" && (
          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-medium text-slate-500">
              {t("reviewProposed")}
            </h4>
            {renderPeriod(summary.after)}
          </div>
        )}
      </div>
    </section>
  );
}
