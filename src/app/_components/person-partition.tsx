"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { Button } from "./ui/button";
import { ChangeReview, InlineNotice, StatePanel } from "./ui/patterns";
import { useDialogPending } from "./ui/modal";

type Preview = RouterOutputs["personCombine"]["partitionPreview"];
type Receipt = RouterOutputs["personCombine"]["partition"];
type Source = Preview["moving"][number];
type Intent = Omit<RouterInputs["personCombine"]["partition"], "confirmPassword">;
const keyOf = (source: Source) => `${source.ref.kind}:${source.ref.id}`;
function errorCode(error: unknown) {
  return (error as { data?: { code?: string } } | null)?.data?.code;
}
const deniedError = (error: unknown) => ["UNAUTHORIZED", "FORBIDDEN"].includes(errorCode(error) ?? "");

/** The owning disclosure retains this controller after collapse and row refresh.
 * Accepted and uncertain writes recover from their receipt, never a new intent. */
export function PersonPartition({ personId, sources: initialSources, unavailable = false, accessDenied = false }: {
  personId: string;
  sources: Source[];
  unavailable?: boolean;
  accessDenied?: boolean;
}) {
  const t = useTranslations("personPartition");
  const common = useTranslations("combineRecords");
  const utils = api.useUtils();
  const candidates = api.personCombine.partitionSources.useQuery({ personId }, { refetchOnMount: "always" });
  const sources = candidates.data ?? initialSources;
  const currentDenied = accessDenied || deniedError(candidates.error);
  const mutation = api.personCombine.partition.useMutation();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [missingReceipt, setMissingReceipt] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [frozenIntent, setFrozenIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDenied, setLocalDenied] = useState(false);
  const [observedPersonId, setObservedPersonId] = useState(personId);
  if (observedPersonId !== personId) {
    setObservedPersonId(personId);
    setSelected([]);
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
  }
  const admission = useRef(false);
  const readAdmission = useRef(false);
  const refreshAdmission = useRef(false);
  const authority = useRef({ personId, accessDenied: currentDenied });
  useLayoutEffect(() => { authority.current = { personId, accessDenied: currentDenied }; }, [personId, currentDenied]);
  const parentBusy = useDialogPending(saving || syncing || uncertain);
  const denied = currentDenied || localDenied;
  const disabled = parentBusy || reading || unavailable || denied || !!receipt || candidates.isLoading || candidates.isFetching || !!candidates.error;

  async function refresh() {
    if (refreshAdmission.current) return;
    refreshAdmission.current = true;
    setSyncing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.accounts),
        () => invalidateAndReport(utils.admin.accountDetails),
        () => invalidateAndReport(utils.admin.tutors),
        () => invalidateAndReport(utils.admin.tutees),
        () => invalidateAndReport(utils.personCombine),
        () => invalidateAndReport(utils.tuteeHistory),
      ]);
      setRefreshFailed(false);
    } catch (failure) {
      setRefreshFailed(true);
      if (deniedError(failure)) setLocalDenied(true);
    } finally {
      refreshAdmission.current = false;
      setSyncing(false);
    }
  }
  async function accept(result: Receipt) {
    setReceipt(result);
    setUncertain(false);
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
    setError(null);
    await refresh();
  }
  async function review() {
    if (disabled || admission.current || readAdmission.current || !selected.length || selected.length >= sources.length) return;
    readAdmission.current = true;
    setReading(true);
    setPreview(null);
    setPassword("");
    setAcknowledged(false);
    setError(null);
    setOperationId(null);
    try {
      const result = await utils.personCombine.partitionPreview.fetch({
        personId, sources: sources.filter((row) => selected.includes(keyOf(row))).map((row) => row.ref),
      }, { staleTime: 0 });
      if (!authority.current.accessDenied && authority.current.personId === personId) setPreview(result);
    } catch (failure) {
      if (deniedError(failure)) setLocalDenied(true);
      setError(failure instanceof Error ? failure.message : common("failed"));
    } finally {
      readAdmission.current = false;
      setReading(false);
    }
  }
  async function commit() {
    if (disabled || !preview?.canSplit || preview.personId !== personId || !acknowledged || reason.trim().length < 10 || !password || admission.current) return;
    const intent: Intent = {
      personId: preview.personId, sources: preview.moving.map((row) => row.ref),
      fingerprint: preview.fingerprint, reason, acknowledged: true, operationId: crypto.randomUUID(),
    };
    setFrozenIntent(intent);
    await submit(intent);
  }
  async function submit(intent: Intent) {
    if (admission.current || saving || syncing || reading || denied || unavailable || candidates.error || candidates.isFetching || !password) return;
    admission.current = true;
    setSaving(true);
    setError(null);
    setMissingReceipt(false);
    setOperationId(intent.operationId);
    try {
      const result = await mutation.mutateAsync({ ...intent, confirmPassword: password });
      await accept(result);
    } catch (failure) {
      const rejected = ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(errorCode(failure) ?? "");
      setUncertain(!rejected);
      setMissingReceipt(false);
      // A rejected plan requires a fresh review; preserve the evidence draft.
      if (rejected) setPreview(null);
      if (deniedError(failure)) setLocalDenied(true);
      setError(failure instanceof Error ? failure.message : common("failed"));
    } finally {
      setPassword("");
      setAcknowledged(false);
      admission.current = false;
      setSaving(false);
    }
  }
  async function recover() {
    if (!operationId || readAdmission.current || saving || syncing) return;
    readAdmission.current = true;
    setReading(true);
    try {
      const result = await utils.personCombine.partitionReceipt.fetch({ operationId }, { staleTime: 0 });
      if (result) await accept(result);
      else setMissingReceipt(true);
    } catch (failure) {
      if (deniedError(failure)) setLocalDenied(true);
      setError(failure instanceof Error ? failure.message : common("failed"));
    } finally {
      readAdmission.current = false;
      setReading(false);
    }
  }
  function list(rows: Source[], title: string) {
    return <section className="min-w-0 rounded-lg border border-slate-200 p-3">
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-2 space-y-2">{rows.map((row) => <li key={keyOf(row)}>
        <p>{row.name}</p><p className="muted text-xs break-all">{common(`kind.${row.ref.kind}`)} · {row.ref.id}</p>
      </li>)}</ul>
    </section>;
  }
  return <div className="space-y-4">
    <p className="text-sm">{t("intro")}</p>
    {operationId && <p className="muted text-xs break-all">{common("operationReference", { id: operationId })}</p>}
    {receipt && <InlineNotice tone="success" announcement="status">
      <p>{t("saved")}</p><p className="muted mt-1 text-xs break-all">{common("receipt", { id: receipt.receiptId })}</p>
    </InlineNotice>}
    {refreshFailed && <InlineNotice tone="warning" announcement="alert" action={<Button disabled={syncing || reading || saving} onClick={() => void refresh()}>{t("refresh")}</Button>}>{t("refreshFailed")}</InlineNotice>}
    {syncing && <p role="status">{common("refreshing")}</p>}
    {uncertain && <InlineNotice tone="warning" announcement="alert" action={<Button disabled={reading || saving || syncing} onClick={() => void recover()}>{common("checkOutcome")}</Button>}>
      <p>{common("uncertain")}</p>{missingReceipt && <p className="mt-2">{common("notRecordedYet")}</p>}
    </InlineNotice>}
    {uncertain && missingReceipt && frozenIntent && !denied && <fieldset disabled={reading || saving || syncing || unavailable} className="space-y-3">
      <p className="text-sm">{t("exactRetryHelp")}</p>
      <label className="block"><span className="label">{common("password")}</span><input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <Button disabled={!password || reading || saving || syncing || unavailable} onClick={() => void submit(frozenIntent)}>{common("retryExact")}</Button>
    </fieldset>}
    {(denied || candidates.error) && <StatePanel kind={denied ? "denied" : "error"} title={common(denied ? "denied" : "failed")}
      action={<Button disabled={saving || syncing || reading || candidates.isFetching} onClick={() => {
        void candidates.refetch().then((result) => { if (!result.error) setLocalDenied(false); });
      }}>{t("refresh")}</Button>} />}
    {error && !denied && <InlineNotice tone="error" announcement="alert">{error}</InlineNotice>}
    {!denied && !receipt && !uncertain && <>
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 font-semibold">{t("choose")}</legend>
        {sources.map((row) => <label key={keyOf(row)} className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.includes(keyOf(row))} onChange={() => {
            if (admission.current || readAdmission.current) return;
            setSelected((previous) => previous.includes(keyOf(row)) ? previous.filter((key) => key !== keyOf(row)) : [...previous, keyOf(row)]);
            setPreview(null); setAcknowledged(false); setPassword(""); setError(null);
          }} />
          <span className="min-w-0"><span className="block font-medium">{row.name}</span><span className="muted block text-xs break-all">{common(`kind.${row.ref.kind}`)} · {row.ref.id}</span></span>
        </label>)}
      </fieldset>
      <Button disabled={disabled || !selected.length || selected.length >= sources.length} onClick={() => void review()}>{reading ? common("loading") : t("review")}</Button>
      {preview && <fieldset disabled={disabled} className="min-w-0">
        <ChangeReview title={t("reviewTitle")} evidence={<>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">{list(preview.remaining, t("remaining"))}{list(preview.moving, t("moving"))}</div>
          {!!preview.blockers.length && <InlineNotice tone="warning"><ul className="space-y-2">{preview.blockers.map((blocker, index) => <li key={`${blocker.reason}:${index}`}>
            <p>{t(`blocker.${blocker.reason}`)}</p><p className="text-xs break-all">{blocker.sources.map((ref) => `${common(`kind.${ref.kind}`)} · ${ref.id}`).join(" / ")}</p>
          </li>)}</ul></InlineNotice>}
        </>} consequences={<p className="text-sm">{t("consequences")}</p>} acknowledgement={<div className="space-y-3">
          <label className="block"><span className="label">{common("evidence")}</span><textarea className="input w-full" rows={3} minLength={10} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); setAcknowledged(false); }} /></label>
          <label className="block"><span className="label">{common("password")}</span><input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("acknowledge")}</span></label>
        </div>} actions={<Button variant="primary" disabled={disabled || !preview.canSplit || !acknowledged || reason.trim().length < 10 || !password} onClick={() => void commit()}>{saving ? common("loading") : t("confirm")}</Button>} />
      </fieldset>}
    </>}
  </div>;
}
