"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Admin review of tutor lifecycle requests (opt-out / reentry). Opt-out approvals are gated until
 * the one-week cooldown elapses; on approval a follow-up prompt offers to re-queue the tutor's
 * tutees onto the signup page. VIEWER is read-only.
 */
export default function TutorRequestsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const requests = api.admin.tutorRequests.useQuery();

  // After an opt-out approval, offer to re-queue that tutor's tutees.
  const [requeue, setRequeue] = useState<{ tutorId: string; name: string; count: number } | null>(
    null,
  );

  const invalidate = () => utils.admin.tutorRequests.invalidate();
  const decide = api.admin.decideTutorRequest.useMutation({ onSuccess: invalidate });
  const requeueTutees = api.admin.requeueTutorTutees.useMutation({
    onSuccess: () => setRequeue(null),
  });

  const onDecide = (
    req: { id: string; kind: string; tutor: { id: string; englishName: string }; affectedTutees: number },
    approve: boolean,
  ) => {
    decide.mutate(
      { requestId: req.id, approve },
      {
        onSuccess: () => {
          if (approve && req.kind === "OPT_OUT" && req.affectedTutees > 0) {
            setRequeue({ tutorId: req.tutor.id, name: req.tutor.englishName, count: req.affectedTutees });
          }
        },
      },
    );
  };

  const list = requests.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.tutorRequests.title")}</h1>
        <p className="muted mt-1">{t("admin.tutorRequests.help")}</p>
      </div>

      {requeue && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            {t("admin.tutorRequests.requeuePrompt", { name: requeue.name, count: requeue.count })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-primary btn-sm"
              onClick={() => requeueTutees.mutate({ tutorId: requeue.tutorId })}
              disabled={requeueTutees.isPending}
            >
              {t("admin.tutorRequests.requeueConfirm")}
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setRequeue(null)}>
              {t("admin.tutorRequests.requeueDismiss")}
            </button>
          </div>
        </div>
      )}

      {decide.error && <p className="text-sm text-red-600">{decide.error.message}</p>}

      <div className="space-y-3">
        {list.map((req) => (
          <div key={req.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {req.tutor.englishName}{" "}
                <span className={req.kind === "OPT_OUT" ? "badge-amber" : "badge-green"}>
                  {t(`admin.tutorRequests.kind.${req.kind}`)}
                </span>
              </p>
              {req.reason && <p className="muted mt-1 text-sm">{req.reason}</p>}
              <p className="muted mt-1 text-xs">
                {req.kind === "OPT_OUT" && req.eligibleAt
                  ? req.approvable
                    ? t("admin.tutorRequests.cooldownDone")
                    : t("admin.tutorRequests.cooldownUntil", {
                        date: new Date(req.eligibleAt).toLocaleDateString(),
                      })
                  : null}
                {req.kind === "OPT_OUT" && req.affectedTutees > 0
                  ? ` · ${t("admin.tutorRequests.affected", { count: req.affectedTutees })}`
                  : ""}
              </p>
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <button
                  className="btn-primary btn-sm"
                  disabled={!req.approvable || decide.isPending}
                  title={!req.approvable ? t("admin.tutorRequests.notYet") : undefined}
                  onClick={() => onDecide(req, true)}
                >
                  {t("admin.tutorRequests.approve")}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  disabled={decide.isPending}
                  onClick={() => onDecide(req, false)}
                >
                  {t("admin.tutorRequests.deny")}
                </button>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="muted">{t("admin.tutorRequests.empty")}</p>}
      </div>
    </div>
  );
}
