"use client";
import { AcceptanceRecords } from "./acceptance-records";
import { SchoolCalendar } from "./school-calendar";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";
import { Pager } from "./student-portal";

export function StudentSupport() {
  const t = useTranslations("workflows");
  const [page, setPage] = useState(0);
  const me = api.account.me.useQuery();
  const staff =
    me.data && ["HEAD", "ADMIN", "COORDINATOR"].includes(me.data.role);
  const setting = api.student.feedbackSettings.useQuery();
  const feedback = api.student.feedbackList.useQuery(
    { page },
    { enabled: !!staff || setting.data === true },
  );
  const appeals = api.student.appeals.useQuery({ page }, { enabled: !!staff });
  const save = api.student.setFeedbackSettings.useMutation({
    onSuccess: () => setting.refetch(),
  });
  const decide = api.student.decideAppeal.useMutation({
    onSuccess: () => appeals.refetch(),
  });
  const { promptText, dialog } = useDialog();
  return (
    <div className="space-y-6">
      {dialog}
      {staff && (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={setting.data ?? false}
              disabled={save.isPending || !setting.isSuccess}
              onChange={(e) => save.mutate({ share: e.target.checked })}
            />
            {t("shareFeedback")}
          </label>
          <Link href="/messages" className="btn-secondary">
            {t("messages")}
          </Link>
          <Link href="/interview-management" className="link">
            {t("qualified")}
          </Link>
          <Link href="/translation-review" className="link">
            {t("reviewDrafts")}
          </Link>
        </section>
      )}
      <section className="card space-y-4 p-6">
        <h2 className="section-title">{t("feedback")}</h2>
        {staff && <p className="muted text-sm">{t("sharingHelp")}</p>}
        {!staff && !setting.data && (
          <p className="muted">{t("privateFeedback")}</p>
        )}
        {feedback.data?.length === 0 && <p className="muted">{t("empty")}</p>}
        {feedback.data?.map((f) => (
          <article
            className="rounded-lg border border-slate-200 p-4"
            key={f.id}
          >
            <p className="font-medium">
              {f.studentName} · {f.subject} · {f.rating}/5
            </p>
            <p className="mt-2 whitespace-pre-wrap">{f.body}</p>
            <p className="muted mt-2 text-xs">{f.updatedAt.toLocaleString()}</p>
          </article>
        ))}
      </section>
      {staff && (
        <section className="card space-y-4 p-6">
          <h2 className="section-title">{t("staffAppeals")}</h2>
          {appeals.data?.length === 0 && <p className="muted">{t("empty")}</p>}
          {appeals.data?.map((a) => (
            <article
              key={a.id}
              className="space-y-3 rounded-lg border border-slate-200 p-4"
            >
              <p className="font-medium">
                {a.studentName} · {a.state}
              </p>
              <p>{a.cardReason}</p>
              <p>{a.body}</p>
              {a.decision && <p className="muted">{a.decision}</p>}
              {a.state === "PENDING" && (
                <div className="flex gap-3">
                  {[true, false].map((overturn) => (
                    <button
                      key={String(overturn)}
                      className="btn-secondary"
                      disabled={decide.isPending}
                      onClick={async () => {
                        const reason = await promptText({
                          title: t("decision"),
                          reasonLabel: t("body"),
                          confirmLabel: t("submit"),
                          cancelLabel: t("cancel"),
                          required: true,
                        });
                        if (reason)
                          decide.mutate({
                            id: a.id,
                            overturn,
                            reason,
                            expectedUpdatedAt: a.updatedAt,
                          });
                      }}
                    >
                      {t(overturn ? "uphold" : "reject")}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      {(save.error ?? feedback.error ?? appeals.error ?? decide.error) && (
        <p role="alert" className="text-red-700">
          {
            (save.error ?? feedback.error ?? appeals.error ?? decide.error)
              ?.message
          }
        </p>
      )}
      {staff && <SchoolCalendar />}
      {staff && <AcceptanceRecords />}
      <Pager
        page={page}
        setPage={setPage}
        more={feedback.data?.length === 20 || appeals.data?.length === 20}
      />
    </div>
  );
}
