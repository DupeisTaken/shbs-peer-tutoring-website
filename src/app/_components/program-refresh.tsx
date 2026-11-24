"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { parseProgramDateTime, programDateTimeInput } from "~/lib/program-time";
import { programTimeZoneInputLabel } from "~/lib/program-time-zone-label";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { NextRecruitmentReview } from "./next-recruitment-review";
import {
  NextRecruitmentError,
  type NextRecruitmentSettingsData,
} from "./next-recruitment-settings";
import {
  RefreshScheduleOverview,
  RefreshStatusBadge,
  evaluateRefreshConditions,
  formatRefreshDateTime,
  formatScheduleDestination,
  refreshSnapshotIdentity,
  type RefreshMode,
  type RefreshPeriod,
  type Schedule,
  type ScheduleData,
} from "./scheduled-program-refresh";
import { useActionReview } from "./ui/action-review";
import { ChoiceButton } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";
import { useProgramWriteAdmission } from "./program-write-admission";

type Props = {
  period: RefreshPeriod;
  canEdit: boolean;
  canApply: boolean;
  /** Independent current-period read failure gates refresh writes without
   * blocking the embedded next-period opening editors. */
  periodReadFailed?: boolean;
  onActivated?: (period: RefreshPeriod) => void;
  /** Embedded Next-Period Signup Openings section rendered inside the unified
   * Program Refresh card while retaining its own admission boundary. */
  nextOpenings?: ReactNode;
};

/** The single entrance for program refreshes (scheduled by default, with
 * immediate execution behind the same confirmation and review boundary). */
export function ProgramRefresh(props: Props) {
  const t = useTranslations("scheduledRefresh");
  const programT = useTranslations("admin.program");
  const headingId = useId();
  const query = api.admin.refreshSchedule.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const [watchedId, setWatchedId] = useState<string>();
  const activeScheduleId = query.data?.schedule?.id;
  if (activeScheduleId && activeScheduleId !== watchedId) {
    setWatchedId(activeScheduleId);
  }
  // The current-source read becomes empty after activation. Keep the prior
  // receipt independently so completion remains visible without rebinding edits.
  const receipt = api.admin.refreshSchedule.useQuery(
    watchedId ? { id: watchedId } : undefined,
    { enabled: !!watchedId, refetchInterval: 30_000 },
  );
  const next = api.program.nextRecruitment.useQuery();
  const historicalSchedule = receipt.data?.schedule;
  const denied = useSessionAccessDenied(query, next, receipt);

  // Promptly recheck an active schedule when prepared openings, timezone or
  // staged features change so invalidated schedules show Needs renewed review
  // immediately rather than waiting for the next 30-second poll.
  const evidenceKey = next.data
    ? JSON.stringify(next.data.refreshEvidence)
    : undefined;
  const previousEvidence = useRef<string | undefined>(undefined);
  const refetchSchedule = query.refetch;
  const scheduleIsActive = query.data?.schedule?.state === "SCHEDULED";
  const hasScheduleError = !!query.error;
  useEffect(() => {
    const prior = previousEvidence.current;
    previousEvidence.current = evidenceKey;
    if (
      prior &&
      evidenceKey &&
      prior !== evidenceKey &&
      scheduleIsActive &&
      !denied &&
      !hasScheduleError
    ) {
      void refetchSchedule();
    }
  }, [evidenceKey, scheduleIsActive, denied, hasScheduleError, refetchSchedule]);

  if (denied) return <StatePanel kind="denied" title={t("readOnly")} />;

  const retry = (
    <button
      type="button"
      className="btn-secondary min-h-11 lg:min-h-10"
      disabled={query.isFetching || next.isFetching || receipt.isFetching}
      onClick={() =>
        void Promise.all([
          query.refetch(),
          next.refetch(),
          ...(watchedId ? [receipt.refetch()] : []),
        ])
      }
    >
      {t("retry")}
    </button>
  );

  if (!query.data || !next.data) {
    const failed = !!query.error || !!next.error;
    const panel = (
      <StatePanel
        kind={failed ? "error" : "loading"}
        title={t(failed ? "loadFailed" : "loading")}
        action={failed ? retry : undefined}
      />
    );
    if (!props.nextOpenings) return panel;
    return (
      <section className="card space-y-5 p-5" aria-labelledby={headingId}>
        <h2 id={headingId} className="section-title">
          {programT("refreshHeading")}
        </h2>
        {panel}
        <div className="border-t border-slate-200 pt-4">{props.nextOpenings}</div>
      </section>
    );
  }

  return (
    <UnifiedProgramRefreshEditor
      {...props}
      data={query.data}
      next={next.data}
      readFailed={!!query.error || !!next.error || !!receipt.error}
      recentSchedule={
        historicalSchedule?.sourceTermId !== query.data.activeSourceTermId
          ? historicalSchedule
          : null
      }
      retry={retry}
    />
  );
}

/** A draft retains its target, timezone and versions until explicit reload or a
 * verified write receipt. Polling never adopts another review on the user's behalf. */
export function UnifiedProgramRefreshEditor({
  period,
  canEdit,
  canApply,
  periodReadFailed = false,
  onActivated,
  nextOpenings,
  data,
  next,
  readFailed,
  retry,
  recentSchedule,
}: Props & {
  data: ScheduleData;
  next: NextRecruitmentSettingsData;
  readFailed: boolean;
  retry: ReactNode;
  recentSchedule?: Schedule | null;
}) {
  const t = useTranslations("scheduledRefresh");
  const programT = useTranslations("admin.program");
  const nextText = useTranslations("nextRecruitment");
  const approvals = useTranslations("approvals");
  const locale = useLocale();
  const id = useId();
  const utils = api.useUtils();
  const saveSchedule = api.admin.scheduleRefresh.useMutation();
  const cancelSchedule = api.admin.cancelRefresh.useMutation();
  const runImmediate = api.admin.refresh.useMutation();
  const review = useActionReview();

  const [snapshot, setSnapshot] = useState({ schedule: data.schedule, next });
  const initialTime = (row: Schedule | null, zone: string) =>
    row ? programDateTimeInput(new Date(row.executeAt), zone) : "";
  const [mode, setMode] = useState<RefreshMode>("scheduled");
  const [time, setTime] = useState(() =>
    initialTime(data.schedule, next.timeZone),
  );
  const [confirm, setConfirm] = useState("");
  const [editing, setEditing] = useState(
    !data.schedule || data.schedule.state === "CANCELLED",
  );
  const [error, setError] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const [approvalId, setApprovalId] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const admitted = useRef(false);

  const allowed = canEdit && data.canEdit && next.canEdit;
  const admission = useProgramWriteAdmission(
    allowed && !readFailed && !periodReadFailed,
  );
  const applies = canApply && data.canApply && next.canApply;
  const latest = useRef({
    allowed,
    data,
    next,
    readFailed: readFailed || periodReadFailed,
  });
  useLayoutEffect(() => {
    latest.current = {
      allowed,
      data,
      next,
      readFailed: readFailed || periodReadFailed,
    };
  }, [allowed, data, next, readFailed, periodReadFailed]);
  const revoke = review.revoke;
  useEffect(() => {
    if (!allowed) revoke();
  }, [allowed, revoke]);

  const row = snapshot.schedule;
  const conditions = evaluateRefreshConditions({
    liveSchedule: data.schedule,
    liveNext: next,
    snapshot,
    period,
    serverNow: data.serverNow,
    mode,
    timeInput: time,
  });
  const key = `program-refresh:${snapshot.next.target.sourceTermId}:${row?.version ?? 0}:${generation}`;
  const blocked =
    !admission.allowed ||
    reloading ||
    !!approvalId ||
    conditions.changed ||
    conditions.stalePreparation ||
    conditions.sourceMismatch ||
    review.blocked(key);
  // Cancelling a stored schedule is independent of changing recruitment evidence.
  const cancelBlocked =
    !admission.allowed ||
    reloading ||
    !!approvalId ||
    JSON.stringify(data.schedule) !== JSON.stringify(row) ||
    review.blocked(key);

  const format = (at: Date | string, zone: string) =>
    formatRefreshDateTime(at, zone, locale);

  function renderScheduleError(message: string) {
    return message.startsWith("NEXT_RECRUITMENT_") ? (
      <NextRecruitmentError message={message} />
    ) : (
      <>
        {t.has(`errors.${message}`) ? t(`errors.${message}`) : t("saveFailed")}
      </>
    );
  }

  const adopt = (
    schedule: Schedule | null,
    preparation: NextRecruitmentSettingsData,
  ) => {
    setSnapshot({ schedule, next: preparation });
    setTime(initialTime(schedule, preparation.timeZone));
    setConfirm("");
    setEditing(!schedule || schedule.state === "CANCELLED");
    setError(undefined);
  };

  const readLatest = async () => {
    await Promise.all([
      utils.admin.refreshSchedule.cancel(),
      utils.program.nextRecruitment.cancel(),
      utils.admin.currentPeriod.cancel(),
    ]);
    const [fresh, preparation, current] = await Promise.all([
      utils.admin.refreshSchedule.fetch(undefined, { staleTime: 0 }),
      utils.program.nextRecruitment.fetch(undefined, { staleTime: 0 }),
      utils.admin.currentPeriod.fetch(undefined, { staleTime: 0 }),
    ]);
    if (
      preparation.target.sourceTermId !== current?.termId ||
      fresh.activeSourceTermId !== current.termId
    )
      throw new Error("SCHEDULED_REFRESH_CHANGED");
    if (!fresh.canEdit || !preparation.canEdit)
      throw new Error("SCHEDULED_REFRESH_CHANGED");
    adopt(fresh.schedule, preparation);
    if (current.termId !== period.termId) onActivated?.(current);
  };

  const reload = async () => {
    if (admitted.current || review.busy || (review.blocked(key) && !approvalId))
      return;
    admitted.current = true;
    setReloading(true);
    setError(undefined);
    try {
      if (approvalId) {
        const input = { requestId: approvalId, page: 0 };
        await utils.approval.list.cancel(input);
        const request = (
          await utils.approval.list.fetch(input, { staleTime: 0 })
        ).rows.find((value) => value.id === approvalId);
        if (!request) throw new Error("SCHEDULED_REFRESH_CHANGED");
        if (request.state === "PENDING") return;
        if (!["APPROVED", "REJECTED", "CANCELLED"].includes(request.state))
          throw new Error("SCHEDULED_REFRESH_CHANGED");
      }
      await readLatest();
      setApprovalId(undefined);
      setGeneration((value) => value + 1);
    } catch {
      setError("SCHEDULED_REFRESH_CHANGED");
    } finally {
      admitted.current = false;
      setReloading(false);
    }
  };

  const openScheduledOrCancel = (cancelling: boolean) => {
    if (!admission.isAllowed() || (cancelling ? cancelBlocked || !row : blocked))
      return;
    let executeAt: Date;
    try {
      executeAt = cancelling
        ? new Date(row!.executeAt)
        : parseProgramDateTime(time, snapshot.next.timeZone);
      if (
        !cancelling &&
        (executeAt.getTime() <= new Date(data.serverNow).getTime() ||
          confirm.trim().toUpperCase() !== "REFRESH")
      ) {
        setError("SCHEDULED_REFRESH_TIME_INVALID");
        return;
      }
    } catch {
      setError("SCHEDULED_REFRESH_TIME_INVALID");
      return;
    }
    if (
      !cancelling &&
      conditions.futureTuteeOpening &&
      executeAt.getTime() > conditions.futureTuteeOpening.getTime()
    ) {
      setError("SCHEDULED_REFRESH_AFTER_OPENING");
      return;
    }
    setError(undefined);
    const captured = snapshot;
    let receiptRow: Schedule | undefined;
    let readAttempts = 0;
    const reviewZone = cancelling ? row!.timeZone : captured.next.timeZone;
    review.open({
      key,
      title: t(cancelling ? "cancelTitle" : "reviewTitle"),
      description: t(cancelling ? "cancelHelp" : "reviewHelp", {
        target: cancelling
          ? formatScheduleDestination(row!)
          : captured.next.nextName,
        time: format(executeAt, reviewZone),
        zone: reviewZone,
      }),
      confirmLabel: applies
        ? t(cancelling ? "cancelSchedule" : "save")
        : approvals("requestHead"),
      confirmVariant: cancelling ? "danger" : "primary",
      successMessage: t(cancelling ? "cancelled" : "saved"),
      details: cancelling ? (
        <p>{t("cancelEffect")}</p>
      ) : (
        <div className="space-y-4">
          <NextRecruitmentReview snapshot={captured.next} />
          <ProgramRefreshEffects target={captured.next.target} />
          <p className="text-sm">{t("catchUp")}</p>
          <p className="text-sm">{t("staleHelp")}</p>
        </div>
      ),
      commit: async () => {
        const current = latest.current;
        const drifted = cancelling
          ? JSON.stringify(current.data.schedule) !==
            JSON.stringify(captured.schedule)
          : refreshSnapshotIdentity(current.data.schedule, current.next) !==
            refreshSnapshotIdentity(captured.schedule, captured.next);
        if (
          !admission.isAllowed() ||
          !current.allowed ||
          current.readFailed ||
          drifted
        )
          throw new Error("SCHEDULED_REFRESH_CHANGED");
        receiptRow = cancelling
          ? await cancelSchedule.mutateAsync({
              id: captured.schedule!.id,
              expectedVersion: captured.schedule!.version,
            })
          : await saveSchedule.mutateAsync({
              confirm: "REFRESH",
              expectedTermId: captured.next.target.sourceTermId,
              expectedPreparation: captured.next.refreshEvidence,
              executeAt,
              expectedScheduleVersion: captured.schedule?.version ?? 0,
            });
        return receiptRow;
      },
      refresh: async () => {
        const explicitRecovery = readAttempts++ > 0;
        if (!receiptRow) throw new Error("SCHEDULED_REFRESH_CHANGED");
        // Read the accepted row by id even if its due execution already advanced
        // the active period. Recovery never submits the scheduling write again.
        const input = { id: receiptRow.id };
        await utils.admin.refreshSchedule.cancel(input);
        const accepted = await utils.admin.refreshSchedule.fetch(input, {
          staleTime: 0,
        });
        if (
          accepted.schedule?.id !== receiptRow.id ||
          accepted.schedule.version < receiptRow.version
        )
          throw new Error("SCHEDULED_REFRESH_CHANGED");
        const superseded =
          new Date(accepted.schedule.executeAt).getTime() !==
            new Date(receiptRow.executeAt).getTime() ||
          (accepted.schedule.version > receiptRow.version &&
            accepted.schedule.state === "SCHEDULED");
        if (superseded && !explicitRecovery)
          throw new Error("SCHEDULED_REFRESH_CHANGED");
        await readLatest();
      },
      approvalId: (failure) => {
        const queued = queuedApprovalId(failure);
        if (queued) setApprovalId(queued);
        return queued;
      },
      renderError: renderScheduleError,
    });
  };

  const openImmediate = () => {
    if (
      !admission.isAllowed() ||
      blocked ||
      confirm.trim().toUpperCase() !== "REFRESH"
    )
      return;
    setError(undefined);
    const captured = snapshot;
    const expectedPreparation = captured.next.refreshEvidence;
    const reviewedConfirm = confirm;
    let readAttempts = 0;
    // Both the modal and mutation close over this same immutable read. A later
    // cache arrival cannot silently replace what the Head reviewed.
    review.open({
      key,
      title: t("immediateReviewTitle"),
      description: programT("advancesTo", { name: captured.next.nextName }),
      confirmLabel: applies
        ? programT("refreshButton", { name: captured.next.nextName })
        : approvals("requestHead"),
      confirmVariant: "danger",
      details: (
        <div className="space-y-4">
          {captured.schedule?.state === "SCHEDULED" && (
            <InlineNotice tone="warning" announcement="status">
              {t("immediateSupersedes")}
            </InlineNotice>
          )}
          <NextRecruitmentReview snapshot={captured.next} />
          <ProgramRefreshEffects target={captured.next.target} />
          <p className="muted text-sm">{nextText("refreshHelp")}</p>
        </div>
      ),
      commit: () => {
        const current = latest.current;
        if (!admission.isAllowed() || !current.allowed || current.readFailed)
          throw new Error(nextText("loadFailed"));
        if (
          JSON.stringify(current.next.refreshEvidence) !==
          JSON.stringify(expectedPreparation)
        )
          throw new Error("NEXT_RECRUITMENT_CHANGED");
        return runImmediate.mutateAsync({
          confirm: reviewedConfirm,
          expectedTermId: captured.next.target.sourceTermId,
          expectedPreparation,
        });
      },
      refresh: async () => {
        const explicitRecovery = readAttempts++ > 0;
        // Cancellation severs pre-write in-flight responses; staleTime alone
        // only affects cached values and still deduplicates old requests.
        await Promise.all([
          utils.admin.currentPeriod.cancel(),
          utils.program.nextRecruitment.cancel(),
          utils.admin.refreshSchedule.cancel(),
        ]);
        const reads = await Promise.allSettled([
          utils.admin.currentPeriod.fetch(undefined, { staleTime: 0 }),
          utils.program.nextRecruitment.fetch(undefined, { staleTime: 0 }),
          utils.admin.refreshSchedule.fetch(undefined, { staleTime: 0 }),
        ]);
        const failed = reads.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        const currentRead = reads[0];
        if (currentRead?.status !== "fulfilled" || !currentRead.value)
          throw new Error(nextText("loadFailed"));
        const currentPeriod = currentRead.value;
        const nextRead = reads[1];
        if (
          nextRead?.status !== "fulfilled" ||
          nextRead.value.target.sourceTermId !== currentPeriod.termId
        )
          throw new Error(nextText("loadFailed"));
        const scheduleRead = reads[2];
        const freshSchedule =
          scheduleRead?.status === "fulfilled"
            ? scheduleRead.value.schedule
            : null;
        const exactDestination =
          currentPeriod.schoolYear ===
            captured.next.target.destinationSchoolYear &&
          currentPeriod.quarter === captured.next.target.destinationQuarter &&
          (!expectedPreparation.destination ||
            currentPeriod.termId === expectedPreparation.destination.termId);
        // A later official refresh can supersede our accepted destination.
        // Explicit read recovery may adopt it, but the old source can never
        // count as evidence that this refresh activated successfully.
        if (
          currentPeriod.termId === captured.next.target.sourceTermId ||
          (!exactDestination && !explicitRecovery)
        )
          throw new Error(nextText("savedChanged"));
        onActivated?.(currentPeriod);
        adopt(freshSchedule, nextRead.value);
        setGeneration((value) => value + 1);
      },
      approvalId: (failure) => {
        const queued = queuedApprovalId(failure);
        if (queued) setApprovalId(queued);
        return queued;
      },
      renderError: (message) => <NextRecruitmentError message={message} />,
      renderResult: (result) => {
        const value = result as RouterOutputs["admin"]["refresh"];
        return (
          <p>
            {programT("done", {
              name: value.name,
              count: value.archivedTutees,
            })}
            {(value.graduatedTutors > 0 || value.agedTutors > 0) &&
              ` ${programT("doneGrad", { graduated: value.graduatedTutors, aged: value.agedTutors })}`}
            {value.pendingTutors > 0 &&
              ` ${programT("donePending", { count: value.pendingTutors })}`}
          </p>
        );
      },
    });
  };

  const confirmMatches = confirm.trim().toUpperCase() === "REFRESH";

  return (
    <section
      className="card space-y-5 p-5"
      aria-labelledby={`${id}-title`}
    >
      {/* Unified header: transition + live schedule badge */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="section-title">
            {programT("refreshHeading")}
          </h2>
          <p className="muted mt-0.5 text-sm">
            {t("subtitle", {
              current: snapshot.next.currentName,
              next: snapshot.next.nextName,
              mode: nextText(
                snapshot.next.target.semesterMode
                  ? "semesterMode"
                  : "quarterMode",
              ),
              zone: snapshot.next.timeZone,
            })}
          </p>
        </div>
        <RefreshStatusBadge
          schedule={data.schedule}
          phase={conditions.schedulePhase}
        />
      </div>

      {readFailed && (
        <InlineNotice tone="error" announcement="alert" action={retry}>
          {t("loadFailed")}
        </InlineNotice>
      )}

      {recentSchedule && (
        <InlineNotice
          tone={recentSchedule.state === "COMPLETED" ? "success" : "warning"}
          announcement="status"
        >
          <p className="font-medium">{t(`states.${recentSchedule.state}`)}</p>
          <p>
            {t("summary", {
              target: formatScheduleDestination(recentSchedule),
              time: format(recentSchedule.executeAt, recentSchedule.timeZone),
              zone: recentSchedule.timeZone,
            })}
          </p>
          {recentSchedule.completedAt && (
            <p className="mt-1 text-xs">
              {t("completedAt", {
                time: format(
                  recentSchedule.completedAt,
                  recentSchedule.timeZone,
                ),
                zone: recentSchedule.timeZone,
              })}
            </p>
          )}
        </InlineNotice>
      )}

      {/* Essential schedule status + staged feature changes */}
      <RefreshScheduleOverview
        liveSchedule={data.schedule}
        conditions={conditions}
      />

      {/* Embedded compact Next-Period Signup Openings (retains independent save/admission boundaries) */}
      {nextOpenings && (
        <div className="border-t border-slate-200 pt-4">{nextOpenings}</div>
      )}

      {/* Single unified refresh entrance */}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            {t("entranceHeading")}
          </h3>
          {allowed && editing && (
            <div
              role="group"
              aria-label={t("timingModeLabel")}
              className="flex flex-wrap items-center gap-1.5"
            >
              <ChoiceButton
                size="compact"
                selected={mode === "scheduled"}
                disabled={blocked}
                onClick={() => {
                  setMode("scheduled");
                  setError(undefined);
                }}
              >
                {t("modeScheduled")}
              </ChoiceButton>
              <ChoiceButton
                size="compact"
                selected={mode === "immediate"}
                disabled={blocked}
                onClick={() => {
                  setMode("immediate");
                  setError(undefined);
                }}
              >
                {t("modeImmediate")}
              </ChoiceButton>
            </div>
          )}
        </div>

        {conditions.changed && (
          <InlineNotice tone="warning" announcement="status">
            {t("changed")}
          </InlineNotice>
        )}
        {conditions.stalePreparation && (
          <InlineNotice tone="warning" announcement="status">
            {t("stalePreparation")}
          </InlineNotice>
        )}
        {!allowed && <p className="muted text-sm">{t("readOnly")}</p>}
        {approvalId && (
          <InlineNotice tone="info" announcement="status">
            <p>{t("pendingApproval")}</p>
            <Link
              className="link inline-flex min-h-11 items-center"
              href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}
            >
              {t("viewRequest")}
            </Link>
          </InlineNotice>
        )}

        {allowed && editing && (
          <fieldset className="relative space-y-3" disabled={blocked}>
            <legend className="sr-only">{t("entranceHeading")}</legend>

            {mode === "immediate" && row?.state === "SCHEDULED" && (
              <InlineNotice tone="warning" announcement="status">
                {t("immediateSupersedes")}
              </InlineNotice>
            )}

            <div
              className={`grid gap-3 ${mode === "scheduled" ? "sm:grid-cols-2" : ""}`}
            >
              {mode === "scheduled" && (
                <div className="min-w-0 space-y-1">
                  <label className="label" htmlFor={`${id}-time`}>
                    {t("timeLabel")}
                  </label>
                  <input
                    id={`${id}-time`}
                    type="datetime-local"
                    className="input min-h-11 w-full min-w-0 lg:min-h-10"
                    value={time}
                    aria-describedby={
                      conditions.futureTuteeOpening
                        ? `${id}-zone ${id}-opening-bound`
                        : `${id}-zone`
                    }
                    onChange={(event) => {
                      setTime(event.target.value);
                      setError(undefined);
                    }}
                  />
                  <p id={`${id}-zone`} className="muted text-xs">
                    {programTimeZoneInputLabel(
                      time,
                      snapshot.next.timeZone,
                      locale,
                    )}
                  </p>
                  {conditions.futureTuteeOpening && (
                    <p id={`${id}-opening-bound`} className="muted text-xs">
                      {t("openingBound", {
                        time: format(
                          conditions.futureTuteeOpening,
                          snapshot.next.timeZone,
                        ),
                        zone: snapshot.next.timeZone,
                      })}
                    </p>
                  )}
                </div>
              )}

              <div className="min-w-0 space-y-1">
                <label className="label" htmlFor={`${id}-confirm`}>
                  {programT("confirmLabel")}
                </label>
                <input
                  id={`${id}-confirm`}
                  className="input min-h-11 w-full min-w-0 sm:max-w-sm lg:min-h-10"
                  value={confirm}
                  placeholder={programT("confirmPlaceholder")}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setError(undefined);
                  }}
                  autoComplete="off"
                />
                {mode === "immediate" && (
                  <p className="muted text-xs">
                    {t("immediateHelp", { target: snapshot.next.nextName })}
                  </p>
                )}
              </div>
            </div>

            {mode === "scheduled" &&
              conditions.timingIssue === "after_tutee_opening" && (
                <InlineNotice tone="warning" announcement="status">
                  {t("errors.SCHEDULED_REFRESH_AFTER_OPENING")}
                </InlineNotice>
              )}
          </fieldset>
        )}

        {error && (
          <InlineNotice tone="error" announcement="alert">
            {renderScheduleError(error)}
          </InlineNotice>
        )}

        {/* Single unified action bar */}
        {allowed && (
          <FormActions>
            {editing ? (
              <>
                {mode === "scheduled" ? (
                  <button
                    type="button"
                    className="btn-primary min-h-11 lg:min-h-10"
                    disabled={
                      blocked ||
                      !time ||
                      !confirmMatches ||
                      conditions.timingIssue === "after_tutee_opening"
                    }
                    onClick={() => openScheduledOrCancel(false)}
                  >
                    {t("review")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-danger min-h-11 lg:min-h-10"
                    disabled={blocked || !confirmMatches}
                    onClick={openImmediate}
                  >
                    {applies
                      ? programT("refreshButton", {
                          name: snapshot.next.nextName,
                        })
                      : approvals("requestHead")}
                  </button>
                )}
                {conditions.hasActiveOrAttentionSchedule && (
                  <button
                    type="button"
                    className="btn-secondary min-h-11 lg:min-h-10"
                    disabled={blocked}
                    onClick={() => {
                      setEditing(false);
                      setConfirm("");
                      setError(undefined);
                    }}
                  >
                    {t("closeEditor")}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="btn-primary min-h-11 lg:min-h-10"
                disabled={blocked}
                onClick={() => {
                  setMode("scheduled");
                  setEditing(true);
                }}
              >
                {t(
                  row && ["BLOCKED", "FAILED"].includes(row.state)
                    ? "reschedule"
                    : row?.state === "SCHEDULED"
                      ? "edit"
                      : "create",
                )}
              </button>
            )}
            {conditions.hasActiveOrAttentionSchedule && (
              <button
                type="button"
                className="btn-danger min-h-11 lg:min-h-10"
                disabled={cancelBlocked}
                onClick={() => openScheduledOrCancel(true)}
              >
                {t("cancelSchedule")}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={
                reloading || review.busy || (review.blocked(key) && !approvalId)
              }
              onClick={() => void reload()}
            >
              {t(approvalId ? "checkApproval" : "reload")}
            </button>
          </FormActions>
        )}
      </div>

      {/* Collapsed details for period-transition effects and full review metadata */}
      <DisclosureSection title={t("effectsDisclosure")} lifetime="lazy">
        <div className="space-y-4">
          <ProgramRefreshEffects target={snapshot.next.target} />
          <NextRecruitmentReview snapshot={snapshot.next} />
          <p className="muted text-xs">{t("staleHelp")}</p>
        </div>
      </DisclosureSection>

      {review.dialog}
    </section>
  );
}
