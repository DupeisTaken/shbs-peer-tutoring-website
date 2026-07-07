"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Upcoming tutor meetings with a self-excuse control. A tutor can excuse an absence (with an
 * optional reason) up to 30 minutes before the meeting; it shows on the admin coordination page.
 * The section hides itself when there are no upcoming meetings.
 */
export function TutorMeetings() {
  const t = useTranslations();
  const utils = api.useUtils();
  const meetings = api.tutor.myMeetings.useQuery();
  const refresh = () => utils.tutor.myMeetings.invalidate();
  const excuse = api.tutor.excuseMeeting.useMutation({ onSuccess: refresh });
  const cancel = api.tutor.cancelMeetingExcuse.useMutation({
    onSuccess: refresh,
  });

  // Which meeting's reason box is open, and its draft text.
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const list = meetings.data ?? [];
  if (list.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("tutor.meetings.title")}</h2>
      <p className="muted mt-1 mb-3">{t("tutor.meetings.help")}</p>
      <ul className="space-y-2">
        {list.map((m) => (
          <li
            key={m.id}
            className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{m.title}</p>
              <p className="muted text-xs">
                {new Date(m.date).toLocaleString()}
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
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ meetingId: m.id })}
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
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("tutor.meetings.reasonPlaceholder")}
                    className="input sm:field-auto min-w-0 sm:min-w-44"
                  />
                  <button
                    className="btn-primary btn-sm"
                    disabled={excuse.isPending}
                    onClick={() => {
                      excuse.mutate({
                        meetingId: m.id,
                        reason: reason.trim() || undefined,
                      });
                      setOpenId(null);
                      setReason("");
                    }}
                  >
                    {t("tutor.meetings.submitExcuse")}
                  </button>
                  <button
                    className="link text-sm"
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
                  onClick={() => {
                    setOpenId(m.id);
                    setReason("");
                  }}
                >
                  {t("tutor.meetings.excuseBtn")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {(excuse.error ?? cancel.error) && (
        <p className="mt-2 text-sm text-red-600">
          {(excuse.error ?? cancel.error)?.message}
        </p>
      )}
    </section>
  );
}
