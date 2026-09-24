"use client";

import { StudentWithdrawals } from "./student-withdrawals";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Student self-service withdrawals require staff review. Tutor-relayed withdrawals retain
 * their recall window; finalized discipline/relay removals retain reinstatement controls.
 * VIEWER can inspect existing removal summaries but cannot read student-review free text.
 */
export default function TuteeRequestsPage() {
  const t = useTranslations();
  const format = useFormatter();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const data = api.admin.tuteeRemovalRequests.useQuery();

  const invalidate = () => utils.admin.tuteeRemovalRequests.invalidate();
  const cancel = api.admin.cancelTuteeOptOut.useMutation({
    onSuccess: invalidate,
  });
  const reinstate = api.admin.reinstateTutee.useMutation({
    onSuccess: invalidate,
  });

  const pending = data.data?.pendingOptOuts ?? [];
  const finalized = data.data?.finalized ?? [];

  const err = data.error ?? cancel.error ?? reinstate.error;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.tuteeRequests.title")}</h1>
        <p className="muted mt-1">{t("admin.tuteeRequests.help")}</p>
      </div>

      {err && <p className="text-sm text-red-600">{err.message}</p>}

      {!readOnly && <StudentWithdrawals />}

      {/* Tutor-relayed withdrawals retain their seven-day recall policy. */}
      <section className="card p-5">
        <h2 className="section-title">
          {t("admin.tuteeRequests.pendingHeading")}{" "}
          <span className="badge-amber ml-1">{pending.length}</span>
        </h2>
        <p className="muted mt-1 text-xs">
          {t("admin.tuteeRequests.pendingHelp")}
        </p>
        <div className="mt-3 space-y-3">
          {pending.map((req) => (
            <div
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {req.tutee.englishName}
                </p>
                <p className="muted mt-1 text-xs">
                  {t("admin.tuteeRequests.relayedBy", {
                    tutor: req.tutorName ?? "—",
                    subject: req.subject ?? "—",
                  })}
                  {req.eligibleAt
                    ? ` · ${t("admin.tuteeRequests.autoApprovesOn", {
                        date: format.dateTime(new Date(req.eligibleAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}`
                    : ""}
                </p>
                <p className="muted mt-1 text-xs">
                  {t("admin.tuteeRequests.wholeProgram")} ·{" "}
                  {t("admin.tuteeRequests.recallWindow")}
                </p>
                {req.reason && (
                  <p className="muted mt-1 text-sm">{req.reason}</p>
                )}
              </div>
              {!readOnly && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ requestId: req.id })}
                >
                  {t("admin.tuteeRequests.cancel")}
                </button>
              )}
            </div>
          ))}
          {pending.length === 0 && (
            <p className="muted">{t("admin.tuteeRequests.pendingEmpty")}</p>
          )}
        </div>
      </section>

      {/* Removed & opted-out (finalized) */}
      <section className="card p-5">
        <h2 className="section-title">
          {t("admin.tuteeRequests.removedHeading")}{" "}
          <span className="badge-slate ml-1">{finalized.length}</span>
        </h2>
        <p className="muted mt-1 text-xs">
          {t("admin.tuteeRequests.removedHelp")}
        </p>
        <div className="mt-3 space-y-2">
          {finalized.map((req) => (
            <div
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {req.tutee.englishName}{" "}
                  <span
                    className={
                      req.kind === "PUNISHMENT" ? "badge-red" : "badge-amber"
                    }
                  >
                    {t(`admin.tuteeRequests.kind.${req.kind}`)}
                  </span>
                </p>
                <p className="muted mt-1 text-xs">
                  {req.kind === "PUNISHMENT"
                    ? t("admin.tuteeRequests.removedDiscipline")
                    : t("admin.tuteeRequests.removedOptOut", {
                        tutor: req.tutorName ?? "—",
                      })}
                  {req.resolvedAt
                    ? ` · ${format.dateTime(new Date(req.resolvedAt), { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                  {req.period ? ` · ${req.period}` : ""}
                </p>
              </div>
              {!readOnly && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={reinstate.isPending}
                  onClick={() => reinstate.mutate({ requestId: req.id })}
                >
                  {t("admin.tuteeRequests.reinstate")}
                </button>
              )}
            </div>
          ))}
          {finalized.length === 0 && (
            <p className="muted">{t("admin.tuteeRequests.removedEmpty")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
