"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { NextRecruitmentReview } from "./next-recruitment-review";
import { NextRecruitmentError } from "./next-recruitment-settings";
import { useActionReview } from "./ui/action-review";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";
import { ScheduledProgramRefresh } from "./scheduled-program-refresh";

type Period = NonNullable<RouterOutputs["admin"]["currentPeriod"]>;

/** The caller mounts this private read only for authorized management identities. */
export function ProgramRefresh({ period, canEdit, canApply, onActivated }: { period: Period; canEdit: boolean; canApply: boolean; onActivated?: (period: Period) => void }) {
  const t = useTranslations("admin.program");
  const nextText = useTranslations("nextRecruitment");
  const approvals = useTranslations("approvals");
  const confirmationId = useId();
  const utils = api.useUtils();
  const query = api.program.nextRecruitment.useQuery();
  const denied = useSessionAccessDenied(query);
  const refresh = api.admin.refresh.useMutation();
  const review = useActionReview();
  const [confirm, setConfirm] = useState("");
  const liveCanEdit = canEdit && !!query.data?.canEdit;
  const liveCanApply = canApply && !!query.data?.canApply;
  const latest = useRef({ canEdit: liveCanEdit, data: query.data, error: query.error });
  // The open dialog retains its immutable review, while admission reads the
  // latest committed authority/evidence. Update before interaction, not in render.
  useLayoutEffect(() => {
    latest.current = { canEdit: liveCanEdit, data: query.data, error: query.error };
  }, [liveCanEdit, query.data, query.error]);
  const revoke = review.revoke;
  useEffect(() => { if (!liveCanEdit || denied) revoke(); }, [liveCanEdit, denied, revoke]);
  if (denied) return <StatePanel kind="denied" title={nextText("readOnly")} />;
  const data = query.data;
  const stale = data ? Object.values(data.preparations).some((row) => row !== null && !row.matchesTarget) : false;
  const key = `refresh:${period.termId}`;
  const blocked = !liveCanEdit || !data || !!query.error || stale || data.target.sourceTermId !== period.termId || review.blocked(key);
  return <><ScheduledProgramRefresh period={period} canEdit={canEdit} canApply={canApply} onActivated={onActivated} /><section className="card space-y-4 border-amber-200 p-5">
    <div><h2 className="section-title">{t("refreshHeading")}</h2><p className="muted mt-1">{t("advancesTo", { name: data?.nextName ?? period.next.name })}</p></div>
    {query.error && <InlineNotice tone="error" announcement="alert" action={<button className="btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{nextText("retry")}</button>}>{nextText("loadFailed")}</InlineNotice>}
    {!data && !query.error && <StatePanel kind="loading" title={nextText("loading")} />}
    {data && <NextRecruitmentReview snapshot={data} />}
    {stale && <InlineNotice tone="warning" announcement="status">{nextText("refreshStale")}</InlineNotice>}
    <p className="muted text-sm">{nextText("refreshHelp")}</p>
    <div className="space-y-2">
      <label className="label" htmlFor={confirmationId}>{t("confirmLabel")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={confirmationId} className="input field-auto min-h-11 min-w-44 lg:min-h-10" disabled={!!blocked} value={confirm} placeholder={t("confirmPlaceholder")} onChange={(event) => setConfirm(event.target.value)} />
        <button className="btn-danger min-h-11 lg:min-h-10" disabled={!!blocked || confirm.trim().toUpperCase() !== "REFRESH"} onClick={() => {
          if (blocked || !data || confirm.trim().toUpperCase() !== "REFRESH") return;
          const snapshot = data;
          const expectedPreparation = snapshot.refreshEvidence;
          const reviewedConfirm = confirm;
          let readAttempts = 0;
          // Both the modal and mutation close over this same immutable read. A
          // later cache arrival cannot silently replace what the Head reviewed.
          review.open({
            key,
            title: t("refreshHeading"),
            description: t("advancesTo", { name: snapshot.nextName }),
            confirmLabel: liveCanApply ? t("refreshButton", { name: snapshot.nextName }) : approvals("requestHead"),
            details: <div className="space-y-4"><NextRecruitmentReview snapshot={snapshot} /><ProgramRefreshEffects target={snapshot.target} /><p className="muted text-sm">{nextText("refreshHelp")}</p></div>,
            commit: () => {
              if (!latest.current.canEdit || latest.current.error || !latest.current.data) throw new Error(nextText("loadFailed"));
              if (JSON.stringify(latest.current.data.refreshEvidence) !== JSON.stringify(expectedPreparation)) throw new Error("NEXT_RECRUITMENT_CHANGED");
              return refresh.mutateAsync({ confirm: reviewedConfirm, expectedTermId: snapshot.target.sourceTermId, expectedPreparation });
            },
            refresh: async () => {
              const explicitRecovery = readAttempts++ > 0;
              // Cancellation severs pre-write in-flight responses; staleTime alone
              // only affects cached values and still deduplicates old requests.
              await Promise.all([utils.admin.currentPeriod.cancel(), utils.program.nextRecruitment.cancel()]);
              const reads = await Promise.allSettled([utils.admin.currentPeriod.fetch(undefined, { staleTime: 0 }), utils.program.nextRecruitment.fetch(undefined, { staleTime: 0 })]);
              const failed = reads.find((result) => result.status === "rejected");
              if (failed?.status === "rejected") throw failed.reason;
              const currentRead = reads[0];
              if (currentRead?.status !== "fulfilled" || !currentRead.value) throw new Error(nextText("loadFailed"));
              const current = currentRead.value;
              const nextRead = reads[1];
              if (nextRead?.status !== "fulfilled" || nextRead.value.target.sourceTermId !== current.termId) throw new Error(nextText("loadFailed"));
              const exactDestination = current.schoolYear === snapshot.target.destinationSchoolYear &&
                current.quarter === snapshot.target.destinationQuarter &&
                (!expectedPreparation.destination || current.termId === expectedPreparation.destination.termId);
              // A later official refresh can supersede our accepted destination.
              // Explicit read recovery may adopt it, but the old source can never
              // count as evidence that this refresh activated successfully.
              if (current.termId === snapshot.target.sourceTermId || (!exactDestination && !explicitRecovery)) throw new Error(nextText("savedChanged"));
              onActivated?.(current);
              setConfirm("");
            },
            approvalId: queuedApprovalId,
            renderError: (message) => <NextRecruitmentError message={message} />,
            renderResult: (result) => {
              const value = result as RouterOutputs["admin"]["refresh"];
              return <p>{t("done", { name: value.name, count: value.archivedTutees })}{(value.graduatedTutors > 0 || value.agedTutors > 0) && ` ${t("doneGrad", { graduated: value.graduatedTutors, aged: value.agedTutors })}`}{value.pendingTutors > 0 && ` ${t("donePending", { count: value.pendingTutors })}`}</p>;
            },
          });
        }}>{liveCanApply ? t("refreshButton", { name: data?.nextName ?? period.next.name }) : approvals("requestHead")}</button>
        <button type="button" className="btn-secondary min-h-11 lg:min-h-10" disabled={query.isFetching || review.busy} onClick={() => void query.refetch()}>{nextText("reloadReview")}</button>
      </div>
    </div>
    {review.dialog}
  </section></>;
}
