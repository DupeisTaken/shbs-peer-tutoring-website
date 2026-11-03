"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { Button } from "./ui/button";
import { ChangeReview, InlineNotice, StatePanel } from "./ui/patterns";
import { useDialogPending } from "./ui/modal";
import { SchoolDeparturePanel } from "./school-departure";

type Inventory = RouterOutputs["personCombine"]["historyCorrectionInventory"];
type Receipt = RouterOutputs["personCombine"]["historyCorrection"];
type Intent = Omit<RouterInputs["personCombine"]["historyCorrection"], "confirmPassword">;
type Decision = Intent["decisions"][number];
type Candidate = RouterOutputs["personCombine"]["candidates"][number];
const rowKey = (row: { entity: string; recordId: string }) => `${row.entity}:${row.recordId}`;
const code = (error: unknown) => (error as { data?: { code?: string } } | null)?.data?.code;
const isDenied = (error: unknown) => ["FORBIDDEN", "UNAUTHORIZED"].includes(code(error) ?? "");

/** Retain this controller with its disclosure: an uncertain correction owns its
 * frozen intent until a receipt or an explicit retry resolves that same operation. */
export function PersonHistoryCorrection({ personId, unavailable = false, accessDenied = false }: {
  personId: string;
  unavailable?: boolean;
  accessDenied?: boolean;
}) {
  const t = useTranslations("personHistoryCorrection");
  const common = useTranslations("combineRecords");
  const regionId = useId();
  const utils = api.useUtils();
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const candidates = api.personCombine.candidates.useQuery({ search: sourceQuery }, { refetchOnMount: "always", enabled: !accessDenied });
  const recipients = api.personCombine.candidates.useQuery({ search: recipientQuery }, { refetchOnMount: "always", enabled: !accessDenied });
  const [sources, setSources] = useState<Candidate[]>([]);
  const [recipient, setRecipient] = useState<Candidate | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
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
  const [frozenIntent, setFrozenIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDenied, setLocalDenied] = useState(false);
  const [departureSource, setDepartureSource] = useState<string | null>(null);
  const currentDenied = accessDenied || isDenied(candidates.error) || isDenied(recipients.error);
  const [observedPersonId, setObservedPersonId] = useState(personId);
  if (observedPersonId !== personId) {
    setObservedPersonId(personId);
    setSources([]);
    setRecipient(null);
    setInventory(null);
    setDecisions([]);
    setPassword("");
    setAcknowledged(false);
  }
  if (currentDenied && !localDenied) {
    setLocalDenied(true);
    setInventory(null);
    setPassword("");
    setAcknowledged(false);
  }
  const admission = useRef(false);
  const readAdmission = useRef(false);
  const refreshAdmission = useRef(false);
  const authority = useRef({ personId, denied: currentDenied, generation: 0 });
  useLayoutEffect(() => { authority.current = { personId, denied: currentDenied, generation: authority.current.generation + 1 }; }, [personId, currentDenied]);
  const parentBusy = useDialogPending(reading || saving || syncing || uncertain);
  const denied = currentDenied || localDenied;
  const queryFailed = !!candidates.error || !!recipients.error;
  const querying = candidates.isFetching || recipients.isFetching;
  const disabled = parentBusy || unavailable || denied || !!receipt || querying || queryFailed;
  const mutation = api.personCombine.historyCorrection.useMutation();
  const message = (failure: unknown) => failure instanceof Error ? failure.message : common("failed");

  function invalidateReview() {
    setInventory(null); setDecisions([]); setAcknowledged(false); setPassword(""); setError(null);
  }
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
      if (isDenied(failure)) { setLocalDenied(true); setInventory(null); }
    } finally { refreshAdmission.current = false; setSyncing(false); }
  }
  async function accept(result: Receipt) {
    setReceipt(result); setUncertain(false); setMissingReceipt(false);
    invalidateReview();
    await refresh();
  }
  async function review() {
    if (disabled || !sources.length || admission.current || readAdmission.current) return;
    readAdmission.current = true;
    const generation = authority.current.generation;
    setReading(true); invalidateReview(); setFrozenIntent(null);
    try {
      const result = await utils.personCombine.historyCorrectionInventory.fetch({
        personId, sourceUserIds: sources.map((source) => source.ref.id), recipientUserId: recipient?.ref.id ?? null,
      }, { staleTime: 0 });
      if (authority.current.personId === personId && authority.current.generation === generation && !authority.current.denied) {
        setInventory(result);
        setDecisions(result.rows.map((row) => ({ entity: row.entity, recordId: row.recordId, action: "RETAIN" })));
      }
    } catch (failure) {
      if (isDenied(failure)) setLocalDenied(true);
      setError(message(failure));
    } finally { readAdmission.current = false; setReading(false); }
  }
  async function submit(intent: Intent) {
    if (admission.current || reading || saving || syncing || denied || unavailable || !password) return;
    admission.current = true; setSaving(true); setError(null); setMissingReceipt(false);
    try { await accept(await mutation.mutateAsync({ ...intent, confirmPassword: password })); }
    catch (failure) {
      const rejected = ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(code(failure) ?? "");
      setUncertain(!rejected);
      if (rejected) setInventory(null);
      if (isDenied(failure)) setLocalDenied(true);
      setError(message(failure));
    } finally { admission.current = false; setSaving(false); setPassword(""); setAcknowledged(false); }
  }
  const pendingCopyConflicts = new Set(inventory?.rows.filter((row) => {
    if (row.entity !== "EmailDelivery" || !row.assignable || !row.sourceNotificationId || decisions.find((choice) => rowKey(choice) === rowKey(row))?.action === "QUARANTINE") return false;
    const notice = inventory.rows.find((source) => source.entity === "Notification" && source.recordId === row.sourceNotificationId);
    if (!notice) return false;
    const action = decisions.find((choice) => rowKey(choice) === rowKey(notice))?.action;
    const nextReader = action === "ASSIGN" ? inventory.recipient?.id ?? null : action === "QUARANTINE" ? null : notice.readerUserId;
    return nextReader !== row.readerUserId;
  }).map(rowKey) ?? []);
  const complete = !!inventory && !pendingCopyConflicts.size && decisions.length === inventory.rows.length && inventory.rows.every((row) =>
    decisions.some((decision) => rowKey(decision) === rowKey(row) &&
      (decision.action === "RETAIN" || (row.assignable && (decision.action !== "ASSIGN" || !!inventory.recipient)))));
  async function commit() {
    if (disabled || inventory?.personId !== personId || !complete || !acknowledged || reason.trim().length < 10 || !password || admission.current) return;
    const intent: Intent = {
      personId: inventory.personId, sourceUserIds: inventory.sourceUsers.map((source) => source.id),
      recipientUserId: inventory.recipient?.id ?? null, decisions,
      fingerprint: inventory.fingerprint, reason, acknowledged: true, operationId: crypto.randomUUID(),
    };
    setFrozenIntent(intent);
    await submit(intent);
  }
  async function recover() {
    if (!frozenIntent || readAdmission.current || saving || syncing) return;
    readAdmission.current = true; setReading(true); setError(null);
    try {
      const result = await utils.personCombine.historyCorrectionReceipt.fetch({ operationId: frozenIntent.operationId }, { staleTime: 0 });
      if (result) await accept(result);
      else setMissingReceipt(true);
    } catch (failure) {
      if (isDenied(failure)) setLocalDenied(true);
      setError(message(failure));
    } finally { readAdmission.current = false; setReading(false); }
  }
  async function reloadAccess() {
    if (readAdmission.current || saving || syncing) return;
    readAdmission.current = true; setReading(true);
    try {
      const result = await Promise.all([candidates.refetch(), recipients.refetch()]);
      if (result.every((query) => !query.error) && !accessDenied) { setLocalDenied(false); invalidateReview(); }
    } catch (failure) {
      if (isDenied(failure)) setLocalDenied(true);
      setError(message(failure));
    } finally { readAdmission.current = false; setReading(false); }
  }
  const retiredSources = candidates.data?.filter((candidate) => candidate.ref.kind === "USER" && candidate.status === "RETIRED" && candidate.personId === personId) ?? [];
  const liveRecipients = recipients.data?.filter((candidate) => candidate.ref.kind === "USER" && candidate.hasLogin) ?? [];
  const reader = (id: string | null) => id ?? t("noReader");
  return <div className="space-y-4">
    <p className="text-sm">{t("intro")}</p>
    {frozenIntent && <p className="muted break-all text-xs">{common("operationReference", { id: frozenIntent.operationId })}</p>}
    {receipt && <InlineNotice tone="success" announcement="status"><p>{t("saved")}</p><p className="mt-1 break-all text-xs">{common("receipt", { id: receipt.receiptId })}</p></InlineNotice>}
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
    {(denied || queryFailed) && <StatePanel kind={denied ? "denied" : "error"} title={common(denied ? "denied" : "failed")} action={<Button disabled={reading || saving || syncing || querying} onClick={() => void reloadAccess()}>{t("refresh")}</Button>} />}
    {error && !denied && <InlineNotice tone="error" announcement="alert">{error}</InlineNotice>}
    {querying && !denied && <p role="status">{common("loading")}</p>}
    {!denied && !receipt && !uncertain && <>
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-semibold">{t("sources")}</legend>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!disabled) setSourceQuery(sourceSearch); }}>
          <label className="min-w-0 flex-1"><span className="label">{t("sourceSearch")}</span><input className="input w-full" value={sourceSearch} maxLength={100} onChange={(event) => setSourceSearch(event.target.value)} /></label>
          <Button type="submit">{t("search")}</Button>
        </form>
        {!retiredSources.length && <p className="muted text-sm">{t("noSources")}</p>}
        {retiredSources.map((source) => <label key={source.ref.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={sources.some((row) => row.ref.id === source.ref.id)} onChange={() => {
            if (readAdmission.current || admission.current) return;
            setSources((previous) => previous.some((row) => row.ref.id === source.ref.id) ? previous.filter((row) => row.ref.id !== source.ref.id) : [...previous, source]); invalidateReview();
          }} /><span className="min-w-0"><span className="block font-medium">{source.name}</span><span className="muted block break-all text-xs">{source.ref.id}</span></span>
        </label>)}
        {!!sources.length && <div><p className="font-medium">{t("selectedSources")}</p><ul className="space-y-1">{sources.map((source) => <li className="flex flex-wrap items-center gap-2 text-sm" key={source.ref.id}><span>{source.name} · {source.ref.id}</span><Button onClick={() => { setSources((previous) => previous.filter((row) => row.ref.id !== source.ref.id)); invalidateReview(); }}>{t("remove")}</Button></li>)}</ul></div>}
      </fieldset>
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-semibold">{t("recipient")}</legend>
        <p className="text-sm">{t("recipientHelp")}</p>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name={`${regionId}-recipient`} checked={!recipient} onChange={() => { setRecipient(null); invalidateReview(); }} />{t("quarantineHistory")}</label>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!disabled) setRecipientQuery(recipientSearch); }}>
          <label className="min-w-0 flex-1"><span className="label">{t("recipientSearch")}</span><input className="input w-full" value={recipientSearch} maxLength={100} onChange={(event) => setRecipientSearch(event.target.value)} /></label><Button type="submit">{t("search")}</Button>
        </form>
        {liveRecipients.map((candidate) => <label key={candidate.ref.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm"><input type="radio" className="mt-1" name={`${regionId}-recipient`} checked={recipient?.ref.id === candidate.ref.id} onChange={() => { setRecipient(candidate); invalidateReview(); }} /><span className="min-w-0"><span className="block font-medium">{candidate.name}</span><span className="muted block break-all text-xs">{candidate.ref.id}</span></span></label>)}
        {recipient && <p className="break-all text-sm">{t("selectedRecipient", { name: recipient.name, id: recipient.ref.id })}</p>}
      </fieldset>
      <Button disabled={disabled || !sources.length} onClick={() => void review()}>{reading ? common("loading") : t("review")}</Button>
      {inventory && <fieldset disabled={disabled} className="min-w-0">
        <ChangeReview title={t("reviewTitle")} evidence={<div className="space-y-4">
          <section><h4 className="font-semibold">{t("historyChanges")}</h4><ul className="mt-2 space-y-2">{inventory.sourceUsers.map((source) => <li key={source.id} className="break-words text-sm"><p>{source.name} · {source.id}</p><p>{t("readerChange", { before: reader(source.readerUserId), after: reader(inventory.recipient?.id ?? null) })}</p></li>)}</ul></section>
          {inventory.recipient && (inventory.recipient.suspended || inventory.recipient.departed) && <InlineNotice tone="warning">{t("recipientRestrictions")}</InlineNotice>}
          <section><h4 className="font-semibold">{t("rowDecisions")}</h4><p className="mt-1 text-sm">{t("rowHelp")}</p>
            {!inventory.rows.length && <p className="muted mt-2 text-sm">{t("noRows")}</p>}
            <div className="mt-3 space-y-3">{inventory.rows.map((row) => <div key={rowKey(row)} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <p className="font-medium">{row.label}</p><p className="muted break-all text-xs">{t(`entity.${row.entity}`)} · {row.recordId}</p>
              <p className="mt-2 break-all text-sm">{t("currentReader", { id: reader(row.readerUserId) })}</p>
              <label className="mt-2 block"><span className="label">{t("decision", { label: row.label })}</span><select className="input w-full" value={decisions.find((decision) => rowKey(decision) === rowKey(row))?.action ?? "RETAIN"} onChange={(event) => {
                const action = event.target.value as Decision["action"];
                setDecisions((previous) => previous.map((decision) => rowKey(decision) === rowKey(row) ? { ...decision, action } : decision)); setAcknowledged(false);
              }}>
                <option value="RETAIN">{t("action.RETAIN")}</option>
                {row.assignable && row.entity !== "EmailDelivery" && inventory.recipient && <option value="ASSIGN">{t("action.ASSIGN")}</option>}
                {row.assignable && <option value="QUARANTINE">{t("action.QUARANTINE")}</option>}
              </select></label>
              <p className="mt-2 text-sm">{row.entity === "EmailDelivery" ? t(row.assignable ? "pendingEmailHelp" : "observedEmailHelp", { status: row.deliveryStatus ?? "" }) : !row.assignable ? t("activeProfile") : row.entity === "StudentQuarterBlock" ? t("restrictionHelp") : t("privateRowHelp")}</p>
              {pendingCopyConflicts.has(rowKey(row)) && <InlineNotice tone="warning" announcement="status">{t("pendingEmailConflict")}</InlineNotice>}
            </div>)}</div>
          </section>
        </div>} consequences={<p className="text-sm">{t("consequences")}</p>} acknowledgement={<div className="space-y-3">
          <label className="block"><span className="label">{common("evidence")}</span><textarea className="input w-full" rows={3} minLength={10} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); setAcknowledged(false); }} /></label>
          <label className="block"><span className="label">{common("password")}</span><input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("acknowledge")}</span></label>
        </div>} actions={<Button variant="primary" disabled={disabled || !complete || !acknowledged || reason.trim().length < 10 || !password} onClick={() => void commit()}>{saving ? common("loading") : t("confirm")}</Button>} />
      </fieldset>}
      {!!sources.length && <section className="space-y-3">
        <p className="text-sm">{t("originalSourceRestrictionHelp")}</p>
        {sources.map((source) => <Button key={source.ref.id} disabled={disabled || reading || saving} onClick={() => setDepartureSource(departureSource === source.ref.id ? null : source.ref.id)}>{t("reviewOriginalDeparture", { name: source.name })}</Button>)}
        {departureSource && sources.some((source) => source.ref.id === departureSource) && <SchoolDeparturePanel userId={departureSource} />}
      </section>}
    </>}
  </div>;
}
