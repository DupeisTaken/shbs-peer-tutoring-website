"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
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
  const admitted = useRef(false);
  const readAdmission = useRef(false);
  const operation = useRef<string | null>(null);
  const status = api.tuteeHistory.exactInvitationStatus.useQuery(
    { sources },
    { refetchOnMount: "always", gcTime: 0, enabled: !accessDenied },
  );
  const concealed = accessDenied || accessLost || denied(status.error);
  const cancellation = useActionReview();
  const revoke = cancellation.revoke;
  useEffect(() => {
    if (accessDenied || denied(status.error)) {
      setAccessLost(true);
      revoke();
    }
  }, [accessDenied, status.error, revoke]);

  const refresh = async (knownReceipt = receipt) => {
    const result = await status.refetch({ throwOnError: true });
    if (result.error) {
      // Refetch can return a serialized tRPC error; preserve its authority code
      // when normalizing the thrown value for recovery and evidence concealment.
      throw Object.assign(new Error(result.error.message), { data: result.error.data });
    }
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
    if (readAdmission.current) return;
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
      setPreview(null);
      setAcknowledged(false);
      setRefreshRequired(true);
      try { await refresh(saved); } catch (cause) {
        if (denied(cause)) setAccessLost(true);
      }
    },
    onError: (failure) => {
      const rejected = ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(failure.data?.code ?? "");
      setUncertain(!rejected);
      setUncertainRevision(null);
      setRefreshRequired(true);
      setPreview(null);
      setAcknowledged(false);
      setError(failure.message);
      if (denied(failure)) setAccessLost(true);
    },
    onSettled: () => { admitted.current = false; },
  });
  const cancel = api.tuteeHistory.cancelExactInvitation.useMutation();
  // Unknown delivery keeps its receipt reader mounted. A confirmed durable
  // attempt instead permits a nested cancellation review; keeping that fence
  // registered would disable the child modal through its inherited busy state.
  const ownPending = send.isPending || cancel.isPending;
  const unresolved = uncertain && !uncertainRevision;
  const dismissalPending = ownPending || unresolved;
  const aggregatePending = useDialogPending(dismissalPending);
  const busy = ownPending || (!unresolved && aggregatePending);
  useEffect(() => {
    onPendingChange?.(dismissalPending);
    return () => onPendingChange?.(false);
  }, [dismissalPending, onPendingChange]);
  useEffect(() => {
    if (denied(cancel.error)) { setAccessLost(true); revoke(); }
  }, [cancel.error, revoke]);
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
    setUncertainRevision(null);
    setError(null);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4">
      <h3 id={`${id}-title`} className="font-semibold">{t("title")}</h3>
      <p className="muted text-sm">{t("help")}</p>
      <QueryFeedback
        hasData={!concealed && status.data !== undefined}
        loading={status.isLoading}
        error={concealed || !!status.error || refreshRequired || uncertain}
        retrying={reading || busy}
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
              setError(null);
              send.mutate({ sources, email, reason, fingerprint: preview.fingerprint, operationId: operation.current });
            }}
          >{history("sendInvitation")}</Button>}
        />}
        {error && <HistoryError message={error} />}
      </>}
      {concealed && <StatePanel kind="denied" title={ui("loadFailed")} />}
      {cancellation.dialog}
    </section>
  );
}
