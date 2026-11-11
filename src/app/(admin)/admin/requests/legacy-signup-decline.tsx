"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { invalidateWorkloads } from "~/lib/workload-cache";
import type { LegacySignupDeclineView } from "~/lib/legacy-signup-decline";
import { localizedLegacySignupDeclineError } from "~/lib/legacy-signup-decline-error";
import { formatWeekday, minToHm } from "~/lib/time";
import { ParticipantName } from "~/app/_components/participant-name";
import { SignupSourceBadge } from "~/app/_components/signup-source-badge";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { useActionReview } from "~/app/_components/ui/action-review";

type DeclineTarget = { id: string; updatedAt: Date; name: string };
type DeclineActions = {
  open: (target: DeclineTarget) => void;
  blocked: (target: Pick<DeclineTarget, "id" | "updatedAt">) => boolean;
  revoke: () => void;
  dialog: ReactNode;
};
const Context = createContext<DeclineActions | null>(null);
const decisionKey = (target: Pick<DeclineTarget, "id" | "updatedAt">) =>
  `legacy-signup-decline:${target.id}:${target.updatedAt.toISOString()}`;

export const useLegacySignupDecline = () => useContext(Context);

/** Own admission and accepted-write recovery above removable queue cards. Only
 * the management branch mounts this mutation; observers receive no controller. */
export function LegacySignupDeclineActions({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("legacySignupDecline");
  const mutation = api.admin.declineSignup.useMutation();
  const review = useActionReview();
  const utils = api.useUtils();
  const refresh = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.admin.tutees),
      () => invalidateAndReport(utils.admin.pairings),
      () => invalidateAndReport(utils.studentWorkflow.adminRequests),
      () => invalidateAndReport(utils.studentWorkflow.legacyReviews),
      () => invalidateWorkloads(utils, true),
    ]);
  return (
    <Context.Provider
      value={{
        revoke: review.revoke,
        dialog: review.dialog,
        blocked: (target) => review.blocked(decisionKey(target)),
        open: (target) => {
          // The same admitted review retains its receipt key across rejected
          // writes; accepted refresh retries below perform reads only.
          const input = {
            id: target.id,
            expectedUpdatedAt: target.updatedAt,
            clientKey: crypto.randomUUID(),
          };
          review.open({
            key: decisionKey(target),
            title: t("title", { name: target.name }),
            description: t("consequence"),
            confirmLabel: t("confirm"),
            details: <p>{target.name}</p>,
            commit: () => mutation.mutateAsync(input),
            refresh,
            approvalId: queuedApprovalId,
            renderError: (message) =>
              localizedLegacySignupDeclineError(message, t) ?? message,
          });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

/** Closed history renders the captured decision-time source, never later
 * canonical profile edits, live subject labels or reassignable roster controls. */
export function DeclinedLegacySignupCard({
  decline,
  order,
}: {
  decline: LegacySignupDeclineView;
  order: number;
}) {
  const t = useTranslations("legacySignupDecline");
  const requests = useTranslations("admin.requests");
  const locale = useLocale();
  const format = useFormatter();
  const { source, availability, pairings } = decline.snapshot;
  return (
    <article
      id={`request-signup-${source.id}`}
      className="card scroll-mt-6 space-y-3 p-5"
    >
      <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
        <span className="badge-slate">#{order}</span>
        <ParticipantName name={source.englishName} />
        <SignupSourceBadge source={source.signupSource} />
        <span className="badge-slate">{t("declined")}</span>
      </div>
      <p className="text-sm text-slate-700">
        {t("decision", {
          when: format.dateTime(decline.resolvedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
          name: decline.resolvedByName ?? t("staff"),
        })}
      </p>
      <p className="text-sm text-slate-700">{t("closedHelp")}</p>
      <DisclosureSection title={t("snapshot")} lifetime="lazy">
        <div className="space-y-2 text-sm text-slate-700">
          <p>{t("snapshotHelp")}</p>
          <p>{decline.snapshot.decisionPeriod.name}</p>
          <p>
            {requests("submitted", {
              when: format.dateTime(
                new Date(source.signupSubmittedAt ?? source.createdAt),
                { dateStyle: "medium", timeStyle: "short" },
              ),
            })}
          </p>
          {source.gradeLevel && (
            <p>{requests("grade", { grade: source.gradeLevel })}</p>
          )}
          <p>
            {requests("firstChoice")}:{" "}
            {source.firstChoice?.name ?? requests("notProvided")}
          </p>
          <p>
            {requests("secondChoice")}:{" "}
            {source.secondChoice?.name ?? requests("notProvided")}
          </p>
          <p>
            {requests("available", {
              list:
                availability
                  .map(
                    (slot) =>
                      `${formatWeekday(slot.dayOfWeek, locale)} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}`,
                  )
                  .join(", ") || "—",
            })}
          </p>
          {source.email && <p className="break-words">{source.email}</p>}
          {source.phone && <p className="break-words">{source.phone}</p>}
          {source.preferredContact && (
            <p className="break-words">
              {requests("reach", { contact: source.preferredContact })}
            </p>
          )}
          <p>
            {source.signedRulebook
              ? requests("signed", { name: source.signatureName ?? "" })
              : requests("notSigned")}
          </p>
          <p>
            {t("released", {
              count: pairings.filter((pairing) => pairing.removed).length,
            })}
          </p>
        </div>
      </DisclosureSection>
    </article>
  );
}
