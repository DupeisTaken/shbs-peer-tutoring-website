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
import { quarterSemester } from "~/lib/period";
import {
  NextRecruitmentError,
  type NextRecruitmentSettingsData,
} from "./next-recruitment-settings";
import { NextRecruitmentReview } from "./next-recruitment-review";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { useSessionAccessDenied } from "./session-view-state";
import { useActionReview } from "./ui/action-review";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";

type ScheduleData = RouterOutputs["admin"]["refreshSchedule"];
type Schedule = NonNullable<ScheduleData["schedule"]>;
type Period = NonNullable<RouterOutputs["admin"]["currentPeriod"]>;
type Props = {
  period: Period;
  canEdit: boolean;
  canApply: boolean;
  onActivated?: (period: Period) => void;
};

function identity(
  schedule: Schedule | null,
  next: NextRecruitmentSettingsData,
) {
  return JSON.stringify({ schedule, evidence: next.refreshEvidence });
}

/** The persisted schedule owns execution; this screen only reads and reviews it. */
export function ScheduledProgramRefresh(props: Props) {
  const t = useTranslations("scheduledRefresh");
  const query = api.admin.refreshSchedule.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const [watchedId, setWatchedId] = useState<string>();
  const activeScheduleId = query.data?.schedule?.id;
  useEffect(() => {
    if (activeScheduleId) setWatchedId(activeScheduleId);
  }, [activeScheduleId]);
  // The current-source read becomes empty after activation. Keep the prior
  // receipt independently so completion remains visible without rebinding edits.
  const receipt = api.admin.refreshSchedule.useQuery(
    watchedId ? { id: watchedId } : undefined,
    { enabled: !!watchedId, refetchInterval: 30_000 },
  );
  const next = api.program.nextRecruitment.useQuery();
  const historicalSchedule = receipt.data?.schedule;
  const denied = useSessionAccessDenied(query, next, receipt);
  if (denied) return <StatePanel kind="denied" title={t("readOnly")} />;
  const retry = (
    <button
      className="btn-secondary"
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
  if (!query.data || !next.data)
    return (
      <StatePanel
        kind={query.error || next.error ? "error" : "loading"}
        title={t(query.error || next.error ? "loadFailed" : "loading")}
        action={(query.error ?? next.error) && retry}
      />
    );
  return (
    <ScheduledRefreshEditor
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
export function ScheduledRefreshEditor({
  period,
  canEdit,
  canApply,
  onActivated,
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
  const approvals = useTranslations("approvals");
  const locale = useLocale();
  const id = useId();
  const utils = api.useUtils();
  const save = api.admin.scheduleRefresh.useMutation();
  const cancel = api.admin.cancelRefresh.useMutation();
  const review = useActionReview();
  const [snapshot, setSnapshot] = useState({ schedule: data.schedule, next });
  const initialTime = (row: Schedule | null, zone: string) =>
    row ? programDateTimeInput(new Date(row.executeAt), zone) : "";
  const [time, setTime] = useState(() =>
    initialTime(data.schedule, next.timeZone),
  );
  const [confirm, setConfirm] = useState("");
  const [editing, setEditing] = useState(!data.schedule);
  const [error, setError] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const [approvalId, setApprovalId] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const admitted = useRef(false);
  const allowed = canEdit && data.canEdit && next.canEdit;
  const applies = canApply && data.canApply;
  const latest = useRef({ allowed, data, next, readFailed });
  useLayoutEffect(() => {
    latest.current = { allowed, data, next, readFailed };
  }, [allowed, data, next, readFailed]);
  const revoke = review.revoke;
  useEffect(() => {
    if (!allowed) revoke();
  }, [allowed, revoke]);
  const row = snapshot.schedule;
  const changed =
    identity(data.schedule, next) !== identity(row, snapshot.next);
  const stalePreparation = Object.values(snapshot.next.preparations).some(
    (value) => value !== null && !value.matchesTarget,
  );
  const key = `scheduled-refresh:${snapshot.next.target.sourceTermId}:${row?.version ?? 0}:${generation}`;
  const blocked =
    !allowed ||
    readFailed ||
    reloading ||
    !!approvalId ||
    changed ||
    stalePreparation ||
    snapshot.next.target.sourceTermId !== period.termId ||
    review.blocked(key);
  // Cancelling a stored schedule is independent of changing recruitment evidence.
  const cancelBlocked =
    !allowed ||
    readFailed ||
    reloading ||
    !!approvalId ||
    JSON.stringify(data.schedule) !== JSON.stringify(row) ||
    review.blocked(key);
  const format = (at: Date, zone: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(at));
  const destination = (value: Schedule) =>
    `${value.destinationSchoolYear} ${value.semesterMode ? quarterSemester(value.destinationQuarter) : value.destinationQuarter}`;

  function renderError(message: string) {
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
    setEditing(!schedule);
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
  const open = (cancelling: boolean) => {
    if (cancelling ? cancelBlocked || !row : blocked) return;
    let executeAt: Date;
    try {
      executeAt = cancelling
        ? new Date(row!.executeAt)
        : parseProgramDateTime(time, snapshot.next.timeZone);
      if (
        !cancelling &&
        (executeAt.getTime() <= new Date(data.serverNow).getTime() ||
          confirm.trim().toUpperCase() !== "REFRESH")
      )
        throw new Error();
    } catch {
      setError("SCHEDULED_REFRESH_TIME_INVALID");
      return;
    }
    setError(undefined);
    const captured = snapshot;
    let receipt: Schedule | undefined;
    let readAttempts = 0;
    const reviewZone = cancelling ? row!.timeZone : captured.next.timeZone;
    review.open({
      key,
      title: t(cancelling ? "cancelTitle" : "reviewTitle"),
      description: t(cancelling ? "cancelHelp" : "reviewHelp", {
        target: cancelling ? destination(row!) : captured.next.nextName,
        time: format(executeAt, reviewZone),
        zone: reviewZone,
      }),
      confirmLabel: applies
        ? t(cancelling ? "cancelSchedule" : "save")
        : approvals("requestHead"),
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
          : identity(current.data.schedule, current.next) !==
            identity(captured.schedule, captured.next);
        if (!current.allowed || current.readFailed || drifted)
          throw new Error("SCHEDULED_REFRESH_CHANGED");
        receipt = cancelling
          ? await cancel.mutateAsync({
              id: captured.schedule!.id,
              expectedVersion: captured.schedule!.version,
            })
          : await save.mutateAsync({
              confirm: "REFRESH",
              expectedTermId: captured.next.target.sourceTermId,
              expectedPreparation: captured.next.refreshEvidence,
              executeAt,
              expectedScheduleVersion: captured.schedule?.version ?? 0,
            });
        return receipt;
      },
      refresh: async () => {
        const explicitRecovery = readAttempts++ > 0;
        if (!receipt) throw new Error("SCHEDULED_REFRESH_CHANGED");
        // Read the accepted row by id even if its due execution already advanced
        // the active period. Recovery never submits the scheduling write again.
        const input = { id: receipt.id };
        await utils.admin.refreshSchedule.cancel(input);
        const accepted = await utils.admin.refreshSchedule.fetch(input, {
          staleTime: 0,
        });
        if (
          accepted.schedule?.id !== receipt.id ||
          accepted.schedule.version < receipt.version
        )
          throw new Error("SCHEDULED_REFRESH_CHANGED");
        const superseded =
          accepted.schedule.executeAt.getTime() !==
            receipt.executeAt.getTime() ||
          (accepted.schedule.version > receipt.version &&
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
      renderError,
    });
  };

  return (
    <section className="card space-y-4 p-5" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="section-title">
          {t("title")}
        </h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
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
              target: destination(recentSchedule),
              time: format(recentSchedule.executeAt, recentSchedule.timeZone),
              zone: recentSchedule.timeZone,
            })}
          </p>
        </InlineNotice>
      )}
      {data.schedule ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="font-medium">{t(`states.${data.schedule.state}`)}</p>
          <p>
            {t("summary", {
              target: destination(data.schedule),
              time: format(data.schedule.executeAt, data.schedule.timeZone),
              zone: data.schedule.timeZone,
            })}
          </p>
          {["BLOCKED", "FAILED"].includes(data.schedule.state) && (
            <p className="text-sm text-amber-900">
              {data.schedule.blockedReason &&
              t.has(`errors.${data.schedule.blockedReason}`)
                ? t(`errors.${data.schedule.blockedReason}`)
                : t("blockedHelp")}
            </p>
          )}
          {data.schedule.state === "SCHEDULED" && (
            <p className="muted text-sm">{t("catchUp")}</p>
          )}
        </div>
      ) : (
        <p className="muted text-sm">{t("none")}</p>
      )}
      {changed && (
        <InlineNotice tone="warning" announcement="status">
          {t("changed")}
        </InlineNotice>
      )}
      {stalePreparation && (
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
        <fieldset className="relative space-y-4" disabled={blocked}>
          <legend className="sr-only">{t("title")}</legend>
          <div>
            <label className="label" htmlFor={`${id}-time`}>
              {t("timeLabel")}
            </label>
            <input
              id={`${id}-time`}
              type="datetime-local"
              className="input mt-1 min-h-11 w-full sm:max-w-sm lg:min-h-10"
              value={time}
              aria-describedby={`${id}-zone`}
              onChange={(event) => setTime(event.target.value)}
            />
            <p id={`${id}-zone`} className="muted mt-1 text-sm">
              {programTimeZoneInputLabel(time, snapshot.next.timeZone, locale)}
            </p>
          </div>
          <p className="text-sm">
            {t("draftTarget", { target: snapshot.next.nextName })}
          </p>
          <div>
            <label className="label" htmlFor={`${id}-confirm`}>
              {t("confirmLabel")}
            </label>
            <input
              id={`${id}-confirm`}
              className="input mt-1 min-h-11 w-full sm:max-w-sm lg:min-h-10"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
            />
          </div>
          <FormActions>
            <button
              type="button"
              className="btn-primary"
              disabled={!time || confirm.trim().toUpperCase() !== "REFRESH"}
              onClick={() => open(false)}
            >
              {t("review")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(false);
                setConfirm("");
              }}
            >
              {t("closeEditor")}
            </button>
          </FormActions>
        </fieldset>
      )}
      {error && (
        <InlineNotice tone="error" announcement="alert">
          {renderError(error)}
        </InlineNotice>
      )}
      <FormActions>
        {allowed && !editing && (
          <button
            type="button"
            className="btn-primary"
            disabled={blocked}
            onClick={() => setEditing(true)}
          >
            {t(
              row && ["SCHEDULED", "BLOCKED", "FAILED"].includes(row.state)
                ? "edit"
                : "create",
            )}
          </button>
        )}
        {allowed &&
          row &&
          ["SCHEDULED", "BLOCKED", "FAILED"].includes(row.state) && (
            <button
              type="button"
              className="btn-danger"
              disabled={cancelBlocked}
              onClick={() => open(true)}
            >
              {t("cancelSchedule")}
            </button>
          )}
        {allowed && (
          <button
            type="button"
            className="btn-secondary"
            disabled={
              reloading || review.busy || (review.blocked(key) && !approvalId)
            }
            onClick={() => void reload()}
          >
            {t(approvalId ? "checkApproval" : "reload")}
          </button>
        )}
      </FormActions>
      {review.dialog}
    </section>
  );
}
