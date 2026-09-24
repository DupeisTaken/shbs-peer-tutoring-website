"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";

/** Both intake sources share the existing timed staff-review mutation and approval policy. */
export function StudentWithdrawals() {
  const t = useTranslations("admin.tuteeRequests");
  const workflow = useTranslations("workflow");
  const format = useFormatter();
  const utils = api.useUtils();
  const rows = api.studentWorkflow.adminRequests.useQuery();
  const legacy = api.studentWorkflow.legacyReviews.useQuery();
  const [decision, setDecision] = useState<{
    id: string;
    name: string;
    approve: boolean;
  } | null>(null);
  const resolve = api.studentWorkflow.resolveReview.useMutation({
    onSuccess: async () => {
      setDecision(null);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.studentWorkflow.legacyReviews.invalidate(),
        utils.admin.tuteeRemovalRequests.invalidate(),
      ]);
    },
  });
  const reviews = [
    ...(rows.data ?? []).flatMap((row) =>
      row.reviews
        .filter((r) => r.kind === "STUDENT_ABORT")
        .map((review) => ({ ...review, name: row.name })),
    ),
    ...(legacy.data ?? []).filter((r) => r.kind === "STUDENT_ABORT"),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const pending = reviews.filter((r) => r.state === "PENDING");
  const completed = reviews.filter((r) => r.state !== "PENDING");
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="section-title">
          {t("studentHeading")}{" "}
          <span className="badge-amber ml-1">{pending.length}</span>
        </h2>
        <p className="muted mt-1 text-sm">{t("studentHelp")}</p>
      </div>
      {(rows.error ?? legacy.error) && (
        <p role="alert" className="text-red-700">
          {(rows.error ?? legacy.error)?.message}
        </p>
      )}
      {rows.isLoading || legacy.isLoading ? (
        <p role="status">{workflow("loading")}</p>
      ) : (
        <>
          {pending.map((review) => (
            <article
              key={review.id}
              className="space-y-3 rounded-lg border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{review.name}</h3>
                <span className="badge-amber">{workflow("needsReview")}</span>
              </div>
              <p className="muted text-sm">
                {t("studentSource")} · {t("wholeProgram")} ·{" "}
                {t("effectiveOnApproval")}
              </p>
              <p className="muted text-xs">
                {t("submittedOn", {
                  date: format.dateTime(new Date(review.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
              <p className="text-sm whitespace-pre-wrap">{review.reason}</p>
              <div className="flex gap-2">
                <button
                  className="btn-danger btn-sm"
                  onClick={() =>
                    setDecision({
                      id: review.id,
                      name: review.name,
                      approve: true,
                    })
                  }
                >
                  {workflow("approve")}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    setDecision({
                      id: review.id,
                      name: review.name,
                      approve: false,
                    })
                  }
                >
                  {workflow("deny")}
                </button>
              </div>
            </article>
          ))}
          {!pending.length && <p className="muted">{t("studentEmpty")}</p>}
          {!!completed.length && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {t("studentHistory")} ({completed.length})
              </summary>
              <div className="mt-3 space-y-2">
                {completed.map((review) => (
                  <article
                    key={review.id}
                    className="rounded-lg bg-slate-50 p-3 text-sm"
                  >
                    <span className="font-medium">{review.name}</span> ·{" "}
                    {workflow(`reviewState.${review.state}`)}
                    <p className="muted mt-1">
                      {t("studentSource")} · {t("wholeProgram")}
                      {review.resolvedAt
                        ? ` · ${format.dateTime(new Date(review.resolvedAt), { dateStyle: "medium", timeStyle: "short" })}`
                        : ""}
                    </p>
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {decision && (
        <TimedActionDialog
          action={decision.approve ? "APPROVE" : "DENY"}
          target={decision.id}
          title={workflow(decision.approve ? "approve" : "deny")}
          message={`${decision.name}\n\n${workflow(decision.approve ? "approveAbortConsequences" : "denyConsequences")}`}
          busy={resolve.isPending}
          error={resolve.error?.message}
          onCancel={() => setDecision(null)}
          onConfirm={(ticket) =>
            resolve.mutate({
              id: decision.id,
              approve: decision.approve,
              ticket,
            })
          }
        />
      )}
    </section>
  );
}
