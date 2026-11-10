"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { Button } from "./ui/button";
import { ChangeReview, FormSection, InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SummaryTable } from "./ui/summary-table";
import { useDialogPending } from "./ui/modal";
import { useActionReview } from "./ui/action-review";
import { HistoryError } from "./tutee-history";

export type HistoricalInvitationSource = { kind: "TUTOR" | "TUTEE"; id: string };
type Preview = RouterOutputs["tuteeHistory"]["previewExactInvitation"];
type Receipt = RouterOutputs["tuteeHistory"]["inviteExact"];
function denied(error: unknown) {
  const value = error as { data?: { code?: string } } | null;
  return ["UNAUTHORIZED", "FORBIDDEN"].includes(value?.data?.code ?? "");
}

/** The first opening freezes the chosen sources. A directory refresh cannot add
 * records to a draft invitation. Server revisions separately fence every write. */
export function HistoricalRecordInvitation({
  sources: initialSources,
  unavailable = false,
  accessDenied = false,
  onCancelled,
  onPendingChange,
}: {
  sources: HistoricalInvitationSource[];
  unavailable?: boolean;
  accessDenied?: boolean;
  /** Invalidate an enclosing participation preview after an accepted cancellation. */
  onCancelled?: () => void;
  /** Standalone hosts also fence sibling actions while delivery is unresolved. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const t = useTranslations("historicalInvitation");
  const history = useTranslations("tuteeHistory");
  const records = useTranslations("combineRecords");
  const ui = useTranslations("uiPatterns");
  const format = useFormatter();
  const id = useId();
  const utils = api.useUtils();
  const [sources] = useState(() => initialSources.map((source) => ({ ...source })));
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [uncertainRevision, setUncertainRevision] = useState<string | null>(null);
  const [missingReceipt, setMissingReceipt] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [stopReview, setStopReview] = useState(false);
  const [stopping, setStopping] = useState(false);
  const admitted = useRef(false);
  const stopAdmission = useRef(false);
  const stopOpener = useRef<HTMLButtonElement>(null);
  const stopReviewNode = useRef<HTMLDivElement>(null);
  const stopParent = useRef<HTMLDialogElement | null>(null);
  const wasStopReview = useRef(false);
  const readAdmission = useRef(false);
  const operation = useRef<string | null>(null);
  const [frozenIntent, setFrozenIntent] = useState<RouterInputs["tuteeHistory"]["inviteExact"] | null>(null);
  const replaying = useRef(false);
  const status = api.tuteeHistory.exactInvitationStatus.useQuery(
    { sources },
    { refetchOnMount: "always", gcTime: 0, enabled: !accessDenied },
  );
  const concealed = accessDenied || accessLost || denied(status.error);
  const cancellation = useActionReview();
  const revoke = cancellation.revoke;
  const statusDenied = accessDenied || denied(status.error);
  const [observedStatusDenial, setObservedStatusDenial] = useState(false);
  if (statusDenied !== observedStatusDenial) {
    setObservedStatusDenial(statusDenied);
    if (statusDenied) { setAccessLost(true); setStopReview(false); }
  }
  useEffect(() => {
    if (statusDenied) revoke();
  }, [statusDenied, revoke]);

  const refresh = async (knownReceipt = receipt) => {
    const result = await status.refetch({ throwOnError: true });
    if (result.error) {
      // Refetch can return a serialized tRPC error; preserve its authority code
      // when normalizing the thrown value for recovery and evidence concealment.
      throw Object.assign(new Error(result.error.message), { data: result.error.data });
    }
    if (result.data === undefined) throw new Error("Invitation status unavailable");
    // A durable admitted attempt can be explicitly superseded. Confirm its exact
    // identity in a fresh scope read before releasing the unknown-outcome fence.
    setUncertainRevision(
      knownReceipt?.status === "UNCERTAIN" &&
      result.data?.attempt?.attemptId === knownReceipt.attemptId &&
      result.data.attempt.status === "UNCERTAIN"
        ? result.data.revision
        : null,
    );
    setRefreshRequired(false);
    setAccessLost(false);
  };
  const recover = async () => {
    if (readAdmission.current || admitted.current || stopAdmission.current) return;
    readAdmission.current = true;
    setReading(true);
    try {
      let knownReceipt = receipt;
      if (uncertain && operation.current) {
        const saved = await utils.tuteeHistory.exactInvitationReceipt.fetch(
          { operationId: operation.current },
          { staleTime: 0 },
        );
        // No receipt is not proof of failure: a delivery may still be running.
        if (!saved) {
          setMissingReceipt(true);
          setUncertainRevision(null);
          // Absence never releases the operation fence. A fresh authorized scope
          // read permits only a replay of the already reviewed, immutable intent.
          await refresh(null);
          setError(null);
          return;
        }
        setReceipt(saved);
        knownReceipt = saved;
        setUncertain(saved.status === "UNCERTAIN");
        setMissingReceipt(false);
      }
      await refresh(knownReceipt);
      setError(null);
    } catch (cause) {
      setRefreshRequired(true);
      if (denied(cause)) setAccessLost(true);
      setError(cause instanceof Error ? cause.message : "failed");
    } finally {
      readAdmission.current = false;
      setReading(false);
    }
  };
  const send = api.tuteeHistory.inviteExact.useMutation({
    onSuccess: async (saved) => {
      setReceipt(saved);
      setUncertain(saved.status === "UNCERTAIN");
      setUncertainRevision(null);
      setMissingReceipt(false);
      setPreview(null);
      setAcknowledged(false);
      setRefreshRequired(true);
      try { await refresh(saved); } catch (cause) {
        if (denied(cause)) setAccessLost(true);
      }
    },
    onError: (failure) => {
      const rejected = ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(failure.data?.code ?? "");
      // A rejected replay cannot prove that the original request will not arrive
      // late. Only a saved receipt resolves that original operation's outcome.
      setUncertain(replaying.current || !rejected);
      setUncertainRevision(null);
      setMissingReceipt(false);
      setRefreshRequired(true);
      setPreview(null);
      setAcknowledged(false);
      setError(failure.message);
      if (denied(failure)) setAccessLost(true);
    },
    onSettled: () => { admitted.current = false; },
  });
  const cancel = api.tuteeHistory.cancelExactInvitation.useMutation();
  const stop = api.tuteeHistory.abandonExactInvitation.useMutation();
  const cancelDenied = denied(cancel.error);
  const [observedCancelDenial, setObservedCancelDenial] = useState(false);
  if (cancelDenied !== observedCancelDenial) {
    setObservedCancelDenial(cancelDenied);
    if (cancelDenied) setAccessLost(true);
  }
  // Unknown delivery keeps its receipt reader mounted. A confirmed durable
  // attempt instead permits a nested cancellation review; keeping that fence
  // registered would disable the child modal through its inherited busy state.
  const ownPending = send.isPending || cancel.isPending || stop.isPending || stopping;
  const unresolved = uncertain && !uncertainRevision;
  const dismissalPending = ownPending || unresolved;
  const aggregatePending = useDialogPending(dismissalPending);
  const busy = ownPending || (!unresolved && aggregatePending);
  useEffect(() => {
    onPendingChange?.(dismissalPending);
    return () => onPendingChange?.(false);
  }, [dismissalPending, onPendingChange]);
  useEffect(() => {
    if (stopReview) stopReviewNode.current?.querySelector<HTMLButtonElement>("[data-stop-cancel]")?.focus();
    else if (wasStopReview.current) {
      if (stopOpener.current && !stopOpener.current.matches(":disabled")) stopOpener.current.focus();
      else stopParent.current?.focus();
    }
    wasStopReview.current = stopReview;
  }, [stopReview]);
  useEffect(() => {
    if (cancelDenied) revoke();
  }, [cancelDenied, revoke]);
  const unavailableForAction = busy || cancellation.busy || reading || unavailable || concealed;
  const disabled = unavailableForAction || uncertain;
  const ready = status.data !== undefined && !status.error && !status.isFetching && !refreshRequired;
  const cancellationDisabled = unavailableForAction || !ready || (uncertain && (
    !uncertainRevision || uncertainRevision !== status.data?.revision ||
    status.data?.attempt?.attemptId !== receipt?.attemptId ||
    status.data?.attempt?.status !== "UNCERTAIN"
  ));
  const clearReview = () => {
    setPreview(null);
    setAcknowledged(false);
    operation.current = null;
    setFrozenIntent(null);
    replaying.current = false;
    setUncertainRevision(null);
    setError(null);
  };
  const stopOriginal = async () => {
    if (stopAdmission.current || admitted.current || readAdmission.current || unavailableForAction || !ready || !stopReview || !uncertain || !missingReceipt || !frozenIntent) return;
    stopAdmission.current = true;
    setStopping(true);
    setError(null);
    try {
      const saved = await stop.mutateAsync(frozenIntent);
      // An already admitted attempt wins the race and returns its receipt. Only
      // ABANDONED proves a permanent stop; UNCERTAIN keeps delivery protected.
      setReceipt(saved);
      setUncertain(saved.status === "UNCERTAIN");
      setUncertainRevision(null);
      setMissingReceipt(false);
      setStopReview(false);
      setRefreshRequired(true);
      try { await refresh(saved); } catch (cause) {
        if (denied(cause)) setAccessLost(true);
      }
    } catch (cause) {
      // A lost stop response may already have committed its closure. Retain the
      // frozen operation and recover its result through receipt reads only.
      setStopReview(false);
      setUncertain(true);
      setMissingReceipt(false);
      setUncertainRevision(null);
      setRefreshRequired(true);
      if (denied(cause)) setAccessLost(true);
      setError(cause instanceof Error ? cause.message : "failed");
    } finally {
      stopAdmission.current = false;
      setStopping(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4">
      <h3 id={`${id}-title`} className="font-semibold">{t("title")}</h3>
      <p className="muted text-sm">{t("help")}</p>
      <QueryFeedback
        hasData={!concealed && status.data !== undefined}
        loading={status.isLoading}
        error={concealed || !!status.error || refreshRequired || uncertain}
        retrying={reading || busy || stopReview}
        loadingTitle={history("loading")}
        errorTitle={history(concealed ? "invitationDenied" : "invitationRefreshFailed")}
        retryLabel={uncertain ? t("checkReceipt") : history("refreshInvitation")}
        onRetry={() => void recover()}
      />
      {uncertain && <InlineNotice tone="warning" announcement="status">
        <p>{t("uncertain")}</p>
        {missingReceipt && <p className="mt-2">{t("notRecorded")}</p>}
      </InlineNotice>}
      {!concealed && <>
        {uncertain && missingReceipt && frozenIntent && <div className="space-y-2">
          <p className="break-all text-sm">{history("invitationRecipient", { email: frozenIntent.email })}</p>
          <p className="muted text-sm">{t("exactRetryHelp")}</p>
          <div className="flex flex-wrap gap-2">
          <Button disabled={unavailableForAction || !ready || stopReview} onClick={() => {
            if (unavailableForAction || !ready || stopReview || admitted.current || readAdmission.current) return;
            admitted.current = true;
            replaying.current = true;
            setMissingReceipt(false);
            setUncertainRevision(null);
            setError(null);
            // The server's actor/input-hash fence returns an admitted receipt
            // without another SMTP attempt, including a late original request.
            send.mutate(frozenIntent);
          }}>{t("retryExact")}</Button>
          <Button ref={stopOpener} variant="danger" disabled={unavailableForAction || !ready || stopReview} onClick={(event) => {
            if (unavailableForAction || !ready || admitted.current || readAdmission.current || stopAdmission.current) return;
            stopParent.current = event.currentTarget.closest("dialog");
            setStopReview(true);
          }}>{t("stopRequest")}</Button>
          </div>
        </div>}
        {receipt && <InlineNotice tone={receipt.status === "PUBLISHED" ? "success" : "warning"} announcement="status">
          {history(`invitation_${receipt.status}`)}
        </InlineNotice>}
        {status.data?.invitation && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="break-all">{history("invitationRecipient", { email: status.data.invitation.email })}</p>
          <p>{history("invitationExpiry", { date: format.dateTime(status.data.invitation.expiresAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
        </div>}
        {status.data?.attempt && !receipt && <InlineNotice announcement="status">
          <p>{history(`invitation_${status.data.attempt.status}`)}</p>
          <p className="break-all">{history("invitationAttemptRecipient", { email: status.data.attempt.email })}</p>
        </InlineNotice>}
        {(!!status.data?.invitation || status.data?.attempt?.status === "UNCERTAIN") && <Button
          disabled={cancellationDisabled || cancellation.blocked("cancel-history-invitation")}
          onClick={() => {
            if (!status.data || cancellationDisabled) return;
            const revision = status.data.revision;
            cancellation.open({
              key: "cancel-history-invitation",
              title: history("cancelInvitation"),
              description: history("cancelInvitationHelp"),
              confirmLabel: history("cancelInvitation"),
              commit: async () => {
                const result = await cancel.mutateAsync({ sources, revision });
                // Acceptance resolves this attempt even if the next read fails.
                // ActionReview retains that result and retries only its refresh.
                setUncertain(false);
                setMissingReceipt(false);
                setReceipt(null);
                clearReview();
                setRefreshRequired(true);
                onCancelled?.();
                return result;
              },
              refresh: async () => { setRefreshRequired(true); await refresh(null); },
              repeatAfterRefresh: true,
            });
          }}
        >{history("cancelInvitation")}</Button>}
        <FormSection title={t("recipient")} disabled={disabled || !ready}>
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !ready || admitted.current || readAdmission.current) return;
            readAdmission.current = true;
            setReading(true);
            clearReview();
            void utils.tuteeHistory.previewExactInvitation.fetch({ sources, email }, { staleTime: 0 })
              .then((result) => { setPreview(result); setReceipt(null); })
              .catch((cause: unknown) => { if (denied(cause)) setAccessLost(true); setError(cause instanceof Error ? cause.message : "failed"); })
              .finally(() => { readAdmission.current = false; setReading(false); });
          }}>
            <label className="block"><span className="label">{history("email")}</span>
              <input className="input w-full" type="email" required maxLength={254} value={email}
                onChange={(event) => { setEmail(event.target.value); clearReview(); }} />
            </label>
            <label className="block"><span className="label">{records("evidence")}</span>
              <textarea className="input w-full" rows={3} required minLength={10} maxLength={1000} value={reason}
                onChange={(event) => { setReason(event.target.value); clearReview(); }} />
            </label>
            <Button type="submit" disabled={!email || reason.trim().length < 10}>{t("review")}</Button>
          </form>
        </FormSection>
        {preview && <ChangeReview
          title={t("reviewTitle")}
          evidence={<div className="space-y-3">
            <p className="break-all">{history("invitationRecipient", { email })}</p>
            <SummaryTable label={t("exactSources")}>
              <thead><tr><th>{records("record")}</th><th>{records("type")}</th><th>{records("reference")}</th></tr></thead>
              <tbody>{preview.sources.map((source) => <tr key={`${source.kind}:${source.id}`}>
                <td>{source.name}</td><td>{records(`kind.${source.kind}`)}</td><td className="text-xs break-all">{source.id}</td>
              </tr>)}</tbody>
            </SummaryTable>
            {preview.blocked.map((code) => <InlineNotice key={code} tone="warning">{t.has(`blocked.${code}`) ? t(`blocked.${code}`) : t("blocked.UNKNOWN")}</InlineNotice>)}
          </div>}
          consequences={<p className="text-sm">{t("consequences")}</p>}
          acknowledgement={<label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} disabled={disabled}
              onChange={(event) => setAcknowledged(event.target.checked)} />{t("acknowledge")}
          </label>}
          actions={<Button variant="primary" disabled={disabled || !ready || !preview.canInvite || !acknowledged}
            onClick={() => {
              if (disabled || !ready || !preview.canInvite || !acknowledged || admitted.current || readAdmission.current) return;
              admitted.current = true;
              operation.current ??= crypto.randomUUID();
              replaying.current = false;
              const intent = { sources: sources.map((source) => ({ ...source })), email, reason, fingerprint: preview.fingerprint, operationId: operation.current };
              setFrozenIntent(intent);
              setError(null);
              send.mutate(intent);
            }}
          >{history("sendInvitation")}</Button>}
        />}
        {error && <HistoryError message={error} />}
      </>}
      {concealed && <StatePanel kind="denied" title={ui("loadFailed")} />}
      {cancellation.dialog}
      {/* This named review stays inline: ancestors may independently register the
          unresolved operation as pending, which would disable a nested modal. */}
      {stopReview && !concealed && frozenIntent && <div ref={stopReviewNode}
        className="rounded-lg border border-slate-200 p-4"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!stopAdmission.current) setStopReview(false);
          }
        }}
      >
        <ChangeReview title={t("stopRequest")}
          evidence={<p className="break-all text-sm">{history("invitationRecipient", { email: frozenIntent.email })}</p>}
          consequences={<p className="text-sm">{t("stopRequestHelp")}</p>}
          actions={<>
            <Button data-stop-cancel disabled={stopping || stop.isPending} onClick={() => { if (!stopAdmission.current) setStopReview(false); }}>{ui("cancel")}</Button>
            <Button variant="danger" disabled={unavailableForAction || !ready} onClick={() => void stopOriginal()}>{t("confirmStopRequest")}</Button>
          </>}
        />
      </div>}
    </section>
  );
}
