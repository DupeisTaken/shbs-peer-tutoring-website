"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Upcoming tutor meetings with a self-excuse control. A tutor can excuse an absence (with an
 * optional reason) at least 60 minutes before the meeting; it shows on the admin coordination page.
 * The section hides itself when there are no upcoming meetings.
 */
export function TutorMeetings() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const utils = api.useUtils();
  const meetings = api.tutor.myMeetings.useQuery();
  const refresh = () => utils.tutor.myMeetings.invalidate();
  const excuse = api.tutor.excuseMeeting.useMutation({
    onSuccess: async () => {
      // A rejected write must leave the editor and its reason available for retry.
      setOpenId(null);
      setReason("");
      await refresh();
    },
  });
  const cancel = api.tutor.cancelMeetingExcuse.useMutation({
    onSuccess: refresh,
  });

  // Which meeting's reason box is open, and its draft text.
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Only announce the latest action; an earlier successful excuse must not
  // appear as success beside a failed cancellation (or another meeting's draft).
  const [lastAction, setLastAction] = useState<"excuse" | "cancel" | null>(
    null,
  );
  const feedback =
    lastAction === "excuse" ? excuse : lastAction === "cancel" ? cancel : null;

  const list = meetings.data ?? [];
  if (list.length === 0 && !meetings.error && !meetings.isLoading) return null;

  return (
    <section id="tutor-meetings" tabIndex={-1} className="card scroll-mt-6 p-5">
      <h2 className="section-title">{t("tutor.meetings.title")}</h2>
      <p className="muted mt-1 mb-3">{t("tutor.meetings.help")}</p>
      {meetings.isLoading && <p role="status">{t("tutor.tasks.loading")}</p>}
      {meetings.error && (
        <p role="alert">
          {meetings.error.message}{" "}
          <button
            className="btn-secondary btn-sm"
            onClick={() => void meetings.refetch()}
          >
            {t("tutor.tasks.retry")}
          </button>
        </p>
      )}
      <ul className="space-y-2">
        {list.map((m) => (
          <li
            key={m.id}
            className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{m.title}</p>
              <p className="muted text-xs">
                {programFormat.dateTime(new Date(m.date), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {m.excused && (
                <p className="mt-0.5 text-xs text-amber-700">
                  {t("tutor.meetings.excused")}
                  {m.reason ? ` — ${m.reason}` : ""}
                </p>
              )}
            </div>

            <div className="min-w-0 sm:shrink-0">
              {m.excused ? (
                m.canExcuse ? (
                  <button
                    className="btn-secondary btn-sm"
                    disabled={cancel.isPending || excuse.isPending}
                    onClick={() => {
                      setLastAction("cancel");
                      cancel.mutate({ meetingId: m.id });
                    }}
                  >
                    {t("tutor.meetings.cancelExcuse")}
                  </button>
                ) : (
                  <span className="badge-amber">
                    {t("tutor.meetings.excusedBadge")}
                  </span>
                )
              ) : !m.canExcuse ? (
                <span className="muted text-xs">
                  {t("tutor.meetings.tooLate")}
                </span>
              ) : openId === m.id ? (
                <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <input
                    value={reason}
                    aria-label={`${m.title}: ${t("tutor.meetings.reasonPlaceholder")}`}
                    disabled={excuse.isPending}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("tutor.meetings.reasonPlaceholder")}
                    className="input sm:field-auto min-w-0 sm:min-w-44"
                  />
                  <button
                    className="btn-primary btn-sm"
                    disabled={excuse.isPending}
                    onClick={() => {
                      setLastAction("excuse");
                      excuse.mutate({
                        meetingId: m.id,
                        reason: reason.trim() || undefined,
                      });
                    }}
                  >
                    {t("tutor.meetings.submitExcuse")}
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={excuse.isPending}
                    onClick={() => {
                      setOpenId(null);
                      setReason("");
                    }}
                  >
                    {t("common.dismiss")}
                  </button>
                </div>
              ) : (
                <button
                  className="btn-secondary btn-sm"
                  disabled={excuse.isPending || cancel.isPending}
                  onClick={() => {
                    setOpenId(m.id);
                    setReason("");
                    setLastAction(null);
                  }}
                >
                  {t("tutor.meetings.excuseBtn")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {feedback?.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {feedback.error.message}
        </p>
      )}
      {feedback?.isSuccess && (
        <p role="status" className="mt-2 text-sm text-green-700">
          {t("workflows.saved")}
        </p>
      )}
    </section>
  );
}
