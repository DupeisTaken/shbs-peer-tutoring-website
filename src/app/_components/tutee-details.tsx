"use client";

import { useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import { EmailContent } from "./email-details";
import { ProfileDialog } from "./profile-dialog";
import { useReadOnly } from "./read-only";
import { TuteeAcademicCell } from "./tutee-academic-cell";
import { TuteeHistoryContent } from "./tutee-history";

/** One on-demand reader combines existing records without widening their audience.
 * Observers keep summary access; private query/mutation children never mount for them.
 */
export function TuteeDetailsDialog({
  row,
  onClose,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
  onClose: () => void;
}) {
  const t = useTranslations("tuteeDetails");
  const roster = useTranslations("admin.tutees");
  const history = useTranslations("tuteeHistory");
  const account = useTranslations("accountProfile");
  const readOnly = useReadOnly();
  const owner = row.owner ?? row.user;
  const email = row.owner?.email ?? row.user?.email ?? row.email;
  const statusClass =
    row.status === "ACTIVE"
      ? "badge-green"
      : row.status === "PENDING"
        ? "badge-amber"
        : "badge-slate";

  return (
    <ProfileDialog
      title={t("title")}
      onClose={onClose}
      size="wide"
    >
      <div className="min-w-0 space-y-6 text-left [overflow-wrap:anywhere] whitespace-normal">
        <p className="muted text-sm">{t(readOnly ? "summaryHelp" : "help")}</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-semibold">{t("overview")}</h3>
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {row.englishName}
              </p>
              {owner?.username && (
                <p className="muted text-sm">@{owner.username}</p>
              )}
            </div>
            <span className={statusClass}>
              {roster(`status.${row.status}`)}
            </span>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="muted mb-1">{history("gradeClass")}</dt>
                <dd>
                  <TuteeAcademicCell row={row} />
                </dd>
              </div>
            </dl>
            <p className="muted text-xs">
              {history("recordId", { id: row.id })}
            </p>
          </section>
          <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold">{t("subjects")}</h3>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="muted mb-1">{roster("firstChoice")}</dt>
                <dd className="font-medium">{row.firstChoice?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="muted mb-1">{roster("secondChoice")}</dt>
                <dd className="font-medium">{row.secondChoice?.name ?? "—"}</dd>
              </div>
            </dl>
          </section>
        </div>
        {!readOnly && (
          <>
            <section className="min-w-0 space-y-3 border-t border-slate-200 pt-5">
              <h3 className="text-lg font-semibold">{t("contact")}</h3>
              {email ? (
                <EmailContent
                  name={row.englishName}
                  email={email}
                  verifiedAt={owner?.emailVerifiedAt}
                  userId={owner?.id}
                  // Retained historical ownership permits contact reads, not current setup writes.
                  canSendSetup={!!row.user}
                  linked={!!owner}
                />
              ) : (
                <p className="muted text-sm">{account("noEmail")}</p>
              )}
            </section>
            <section className="min-w-0 space-y-4 border-t border-slate-200 pt-5">
              <h3 className="text-lg font-semibold">{history("details")}</h3>
              <TuteeHistoryContent key={row.id} tuteeId={row.id} />
            </section>
          </>
        )}
      </div>
    </ProfileDialog>
  );
}
