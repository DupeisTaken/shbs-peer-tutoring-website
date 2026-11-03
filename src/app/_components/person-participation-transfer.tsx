"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { formatWeekday, minToHm } from "~/lib/time";
import { Button } from "./ui/button";
import { ChangeReview, InlineNotice, StatePanel } from "./ui/patterns";
import { useDialogPending } from "./ui/modal";

type Preview = RouterOutputs["personCombine"]["participationPreview"];
type Receipt = RouterOutputs["personCombine"]["participationTransfer"];
type Selection = RouterInputs["personCombine"]["participationPreview"];
type Intent = Omit<RouterInputs["personCombine"]["participationTransfer"], "confirmPassword">;
type Candidate = RouterOutputs["personCombine"]["candidates"][number];
const key = (source: Candidate) => `${source.ref.kind}:${source.ref.id}`;
const code = (error: unknown) => (error as { data?: { code?: string } } | null)?.data?.code;
const isDenied = (error: unknown) => ["FORBIDDEN", "UNAUTHORIZED"].includes(code(error) ?? "");

/** A retained review owns its selected operational evidence and durable receipt.
 * Refreshes and lost responses never silently create a second transfer intent. */
export function PersonParticipationTransfer({ personId, unavailable = false, accessDenied = false }: {
  personId: string; unavailable?: boolean; accessDenied?: boolean;
}) {
  const t = useTranslations("personParticipationTransfer");
  const common = useTranslations("combineRecords");
  const locale = useLocale();
  const format = useFormatter();
  const regionId = useId();
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const candidates = api.personCombine.candidates.useQuery({ search: query }, { enabled: !accessDenied, refetchOnMount: "always" });
  const [sources, setSources] = useState<Candidate[]>([]);
  const [retained, setRetained] = useState<Candidate | null>(null);
  const [activeTutorId, setActiveTutorId] = useState<string | null>(null);
  const [activeTuteeId, setActiveTuteeId] = useState<string | null>(null);
  const [willingnessSource, setWillingnessSource] = useState("");
  const [availabilitySource, setAvailabilitySource] = useState("");
  const [historyAccessCorrection, setHistoryAccessCorrection] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewedSelection, setReviewedSelection] = useState<Selection | null>(null);
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
  const currentDenied = accessDenied || isDenied(candidates.error);
  const [observedPersonId, setObservedPersonId] = useState(personId);
  if (observedPersonId !== personId) {
    setObservedPersonId(personId); setSources([]); setRetained(null);
    setActiveTutorId(null); setActiveTuteeId(null); setWillingnessSource(""); setAvailabilitySource("");
    setHistoryAccessCorrection(false);
    setPreview(null); setReviewedSelection(null); setPassword(""); setAcknowledged(false);
  }
  if (currentDenied && !localDenied) {
    setLocalDenied(true); setPreview(null); setReviewedSelection(null); setPassword(""); setAcknowledged(false); setHistoryAccessCorrection(false);
  }
  const admission = useRef(false);
  const readAdmission = useRef(false);
  const refreshAdmission = useRef(false);
  const authority = useRef({ personId, denied: currentDenied, generation: 0 });
  useLayoutEffect(() => { authority.current = { personId, denied: currentDenied, generation: authority.current.generation + 1 }; }, [personId, currentDenied]);
  const parentBusy = useDialogPending(reading || saving || syncing || uncertain);
  const denied = currentDenied || localDenied;
  const disabled = parentBusy || unavailable || denied || !!receipt || candidates.isFetching || !!candidates.error;
  const mutation = api.personCombine.participationTransfer.useMutation();
  const tutors = sources.filter((source) => source.ref.kind === "TUTOR");
  const tutees = sources.filter((source) => source.ref.kind === "TUTEE");
  const validSelection = !!retained && !!sources.length && (!tutors.length || tutors.some((row) => row.ref.id === activeTutorId)) && (!tutees.length || tutees.some((row) => row.ref.id === activeTuteeId));
  const message = (failure: unknown) => failure instanceof Error ? failure.message : common("failed");
  const date = (value: Date | string | null) => value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : t("notRecorded");
  function invalidateReview(preserveHistoryChoice = false) { setPreview(null); setReviewedSelection(null); setPassword(""); setAcknowledged(false); setError(null); if (!preserveHistoryChoice) setHistoryAccessCorrection(false); }
  function remove(source: Candidate) {
    setSources((previous) => previous.filter((row) => key(row) !== key(source)));
    if (source.ref.kind === "TUTOR") {
      if (activeTutorId === source.ref.id) setActiveTutorId(null);
      if (willingnessSource === source.ref.id) setWillingnessSource("");
      if (availabilitySource === source.ref.id) setAvailabilitySource("");
    } else if (activeTuteeId === source.ref.id) setActiveTuteeId(null);
    invalidateReview();
  }
  async function refresh() {
    if (refreshAdmission.current) return;
    refreshAdmission.current = true; setSyncing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.accounts), () => invalidateAndReport(utils.admin.accountDetails),
        () => invalidateAndReport(utils.admin.tutors), () => invalidateAndReport(utils.admin.tutees),
        () => invalidateAndReport(utils.personCombine), () => invalidateAndReport(utils.tuteeHistory),
      ]);
      setRefreshFailed(false);
    } catch (failure) { setRefreshFailed(true); if (isDenied(failure)) { setLocalDenied(true); setPreview(null); } }
    finally { refreshAdmission.current = false; setSyncing(false); }
  }
  async function accept(result: Receipt) { setReceipt(result); setUncertain(false); setMissingReceipt(false); invalidateReview(); await refresh(); }
  async function review() {
    if (disabled || !validSelection || !retained || readAdmission.current || admission.current) return;
    const selection: Selection = {
      personId, retainedUserId: retained.ref.id, activeTutorId: tutors.length ? activeTutorId : null,
      activeTuteeId: tutees.length ? activeTuteeId : null,
      tutorIds: tutors.map((row) => row.ref.id).sort(), tuteeIds: tutees.map((row) => row.ref.id).sort(),
      ...(willingnessSource ? { willingnessSourceTutorId: willingnessSource } : {}),
      ...(availabilitySource ? { availabilitySourceTutorId: availabilitySource } : {}),
      ...(historyAccessCorrection ? { acknowledgeHistoryAccessCorrection: true } : {}),
    };
    readAdmission.current = true; setReading(true); invalidateReview(true); setFrozenIntent(null);
    const generation = authority.current.generation;
    try {
      const result = await utils.personCombine.participationPreview.fetch(selection, { staleTime: 0 });
      if (authority.current.personId === personId && authority.current.generation === generation && !authority.current.denied) { setPreview(result); setReviewedSelection(selection); }
    } catch (failure) { if (isDenied(failure)) setLocalDenied(true); setError(message(failure)); }
    finally { readAdmission.current = false; setReading(false); }
  }
  async function submit(intent: Intent) {
    if (admission.current || reading || saving || syncing || denied || unavailable || !password) return;
    admission.current = true; setSaving(true); setError(null); setMissingReceipt(false);
    try { await accept(await mutation.mutateAsync({ ...intent, confirmPassword: password })); }
    catch (failure) {
      const rejected = ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(code(failure) ?? "");
      setUncertain(!rejected); if (rejected) { setPreview(null); setReviewedSelection(null); }
      if (isDenied(failure)) setLocalDenied(true); setError(message(failure));
    } finally { admission.current = false; setSaving(false); setPassword(""); setAcknowledged(false); }
  }
  async function commit() {
    if (disabled || !preview?.canTransfer || preview.personId !== personId || !reviewedSelection || !acknowledged || reason.trim().length < 10 || !password || admission.current) return;
    const intent: Intent = { ...reviewedSelection, fingerprint: preview.fingerprint, reason, acknowledged: true, operationId: crypto.randomUUID() };
    setFrozenIntent(intent); await submit(intent);
  }
  async function recover() {
    if (!frozenIntent || readAdmission.current || saving || syncing) return;
    readAdmission.current = true; setReading(true); setError(null);
    try {
      const result = await utils.personCombine.participationReceipt.fetch({ operationId: frozenIntent.operationId }, { staleTime: 0 });
      if (result) await accept(result); else setMissingReceipt(true);
    } catch (failure) { if (isDenied(failure)) setLocalDenied(true); setError(message(failure)); }
    finally { readAdmission.current = false; setReading(false); }
  }
  async function reloadAccess() {
    if (readAdmission.current || saving || syncing) return;
    readAdmission.current = true; setReading(true);
    try { const result = await candidates.refetch(); if (!result.error && !accessDenied) { setLocalDenied(false); invalidateReview(); } }
    catch (failure) { if (isDenied(failure)) setLocalDenied(true); setError(message(failure)); }
    finally { readAdmission.current = false; setReading(false); }
  }
  const groupCandidates = candidates.data?.filter((row) => row.personId === personId) ?? [];
  const sourceName = (id: string | null) => id ? `${preview?.sources.find((row) => row.id === id)?.name ?? sources.find((row) => row.ref.id === id)?.name ?? ""} · ${id}` : t("none");
  const choose = (rows: Candidate[], value: string | null, label: string, change: (id: string | null) => void, optional = false) => <label className="block"><span className="label">{label}</span><select className="input w-full" value={value ?? ""} onChange={(event) => { change(event.target.value || null); invalidateReview(); }}><option value="">{t(optional ? "keepActive" : "choose")}</option>{rows.map((row) => <option key={key(row)} value={row.ref.id}>{row.name} · {row.ref.id}</option>)}</select></label>;
  const recordedState = (value: string) => {
    const labels: Record<string, string> = { SCHEDULED: t("state.SCHEDULED"), RECORDED: t("state.RECORDED"), COMPLETED: t("state.COMPLETED"), CANCELLED: t("state.CANCELLED"), PENDING: t("state.PENDING"), ACCEPTED: t("state.ACCEPTED"), REJECTED: t("state.REJECTED"), DECLINED: t("state.DECLINED"), EXPIRED: t("state.EXPIRED"), SUPERSEDED: t("state.SUPERSEDED") };
    return labels[value] ?? t("otherState", { state: value });
  };
  return <div className="space-y-4">
    <p className="text-sm">{t("intro")}</p>
    {frozenIntent && <p className="muted break-all text-xs">{common("operationReference", { id: frozenIntent.operationId })}</p>}
    {receipt && <InlineNotice tone="success" announcement="status"><p>{t("saved")}</p><p className="mt-1 break-all text-xs">{common("receipt", { id: receipt.receiptId })}</p><p className="mt-2 text-sm">{t("successors", { count: receipt.successorPairingIds.length })}</p></InlineNotice>}
    {refreshFailed && <InlineNotice tone="warning" announcement="alert" action={<Button disabled={syncing || saving || reading} onClick={() => void refresh()}>{t("refresh")}</Button>}>{t("refreshFailed")}</InlineNotice>}
    {syncing && <p role="status">{common("refreshing")}</p>}
    {uncertain && <InlineNotice tone="warning" announcement="alert" action={<Button disabled={reading || saving || syncing} onClick={() => void recover()}>{common("checkOutcome")}</Button>}><p>{common("uncertain")}</p>{missingReceipt && <p className="mt-2">{common("notRecordedYet")}</p>}</InlineNotice>}
    {uncertain && missingReceipt && frozenIntent && !denied && <fieldset disabled={reading || saving || syncing || unavailable} className="space-y-3"><p className="text-sm">{t("exactRetryHelp")}</p><label className="block"><span className="label">{common("password")}</span><input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><Button disabled={!password || reading || saving || syncing || unavailable} onClick={() => void submit(frozenIntent)}>{common("retryExact")}</Button></fieldset>}
    {(denied || candidates.error) && <StatePanel kind={denied ? "denied" : "error"} title={common(denied ? "denied" : "failed")} action={<Button disabled={reading || saving || syncing || candidates.isFetching} onClick={() => void reloadAccess()}>{t("refresh")}</Button>} />}
    {error && !denied && <InlineNotice tone="error" announcement="alert">{error}</InlineNotice>}
    {candidates.isFetching && !denied && <p role="status">{common("loading")}</p>}
    {!denied && !receipt && !uncertain && <>
      <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 font-semibold">{t("selectSources")}</legend>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!disabled) setQuery(search); }}><label className="min-w-0 flex-1"><span className="label">{t("searchLabel")}</span><input className="input w-full" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label><Button type="submit">{t("search")}</Button></form>
        {!groupCandidates.length && <p className="muted text-sm">{t("noSources")}</p>}
        {groupCandidates.filter((row) => row.ref.kind !== "USER").map((source) => <label key={key(source)} className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={sources.some((row) => key(row) === key(source))} onChange={() => { if (admission.current || readAdmission.current) return; if (sources.some((row) => key(row) === key(source))) remove(source); else { setSources((previous) => [...previous, source]); invalidateReview(); } }} /><span className="min-w-0"><span className="block font-medium">{source.name}</span><span className="muted block break-all text-xs">{common(`kind.${source.ref.kind}`)} · {source.ref.id}</span></span></label>)}
        {!!sources.length && <ul className="space-y-1">{sources.map((source) => <li key={key(source)} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-all">{source.name} · {source.ref.id}</span><Button onClick={() => remove(source)}>{t("remove")}</Button></li>)}</ul>}
        <fieldset className="space-y-2"><legend className="mb-2 font-semibold">{t("retainedLogin")}</legend>{groupCandidates.filter((row) => row.ref.kind === "USER" && row.hasLogin).map((row) => <label key={key(row)} className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name={`${regionId}-retained`} checked={retained?.ref.id === row.ref.id} onChange={() => { setRetained(row); invalidateReview(); }} /><span className="break-all">{row.name} · {row.ref.id}</span></label>)}{retained && <p className="break-all text-sm">{t("retainedSelected", { name: retained.name, id: retained.ref.id })}</p>}</fieldset>
        {!!tutors.length && choose(tutors, activeTutorId, t("activeTutor"), setActiveTutorId)}
        {!!tutees.length && choose(tutees, activeTuteeId, t("activeTutee"), setActiveTuteeId)}
        {!!tutors.length && <><p className="text-sm">{t("preferenceHelp")}</p>{choose(tutors, willingnessSource, t("willingnessSource"), (id) => setWillingnessSource(id ?? ""), true)}{choose(tutors, availabilitySource, t("availabilitySource"), (id) => setAvailabilitySource(id ?? ""), true)}<p className="muted text-sm">{t("defaultPreferences")}</p></>}
        {(!!preview?.accessChanges.length || historyAccessCorrection) && <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={historyAccessCorrection} onChange={(event) => { setHistoryAccessCorrection(event.target.checked); invalidateReview(true); }} /><span>{t("reviewHistoryAccess")}</span></label>}
      </fieldset>
      <Button disabled={disabled || !validSelection} onClick={() => void review()}>{reading ? common("loading") : t("review")}</Button>
      {preview && <fieldset disabled={disabled} className="min-w-0"><ChangeReview title={t("reviewTitle")} evidence={<div className="space-y-4">
        <section><h4 className="font-semibold">{t("activeResult")}</h4><p className="break-all text-sm">{t("accountReference", { id: preview.retainedUserId })}</p><p className="break-all text-sm">{t("tutorResult", { source: sourceName(preview.activeTutorId) })}</p><p className="break-all text-sm">{t("tuteeResult", { source: sourceName(preview.activeTuteeId) })}</p><ul className="mt-2 space-y-1">{preview.sources.map((source) => <li key={`${source.kind}:${source.id}`} className="break-all text-sm">{common(`kind.${source.kind}`)} · {source.name} · {source.id}</li>)}</ul></section>
        {!!preview.accessChanges.length && <section><h4 className="font-semibold">{t("historyAccessChanges")}</h4><p className="text-sm">{t("historyAccessHelp")}</p><ul className="mt-2 space-y-2">{preview.accessChanges.map((change) => <li key={`${change.kind}:${change.id}`} className="break-all text-sm"><p>{common(`kind.${change.kind}`)} · {change.id}</p><p>{t("historyReaderChange", { before: change.previousReaderUserId ?? t("none"), after: change.readerUserId, revision: change.revision })}</p></li>)}</ul></section>}
        {!!preview.sourceRestrictions.length && <section><h4 className="font-semibold">{t("sourceRestrictions")}</h4><p className="text-sm">{t("sourceRestrictionsHelp")}</p><ul className="mt-2 space-y-3">{preview.sourceRestrictions.map((source) => <li key={`${source.kind}:${source.sourceId}`} className="rounded border p-3 text-sm"><p className="break-all">{common(`kind.${source.kind}`)} · {source.sourceId}</p><p className="break-all">{t("sourceAccounts", { ids: source.sourceUserIds.join(", ") || t("none"), revision: source.ownershipRevision ?? t("notRecorded") })}</p>{source.blockers.length ? <ul className="mt-1 space-y-1">{source.blockers.map((blocker) => <li key={`${blocker.userId}:${blocker.reason}`} className="break-all font-medium text-amber-800">{blocker.userId} · {t(`restriction.${blocker.reason}`)}</li>)}</ul> : <p>{t("sourceClear")}</p>}</li>)}</ul></section>}
        {preview.activeTuteeId && <section><h4 className="font-semibold">{t("discipline")}</h4><p className="text-sm">{t("disciplineCounts", { yellow: preview.discipline.validYellow, red: preview.discipline.validRed })}</p>{preview.discipline.willRemove && <InlineNotice tone="warning" announcement="alert">{t("disciplineRemoval")}</InlineNotice>}</section>}
        {!!preview.blockers.length && <InlineNotice tone="warning"><h4 className="font-semibold">{t("blockers")}</h4><ul className="mt-2 space-y-3">{preview.blockers.map((blocker, index) => <li key={`${blocker.kind}:${blocker.id}:${index}`}><p>{t(`blocker.${blocker.code}`)}</p><p className="break-all text-xs">{t("recordReference", { id: blocker.id })}</p></li>)}</ul></InlineNotice>}
        <section><h4 className="font-semibold">{t("assignments")}</h4>{!preview.assignments.length && <p className="muted text-sm">{t("noAssignments")}</p>}<ul className="mt-2 space-y-3">{preview.assignments.map((row) => <li key={row.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-medium">{row.subject}</p><p className="break-all">{t("recordReference", { id: row.id })} · {row.termId}</p><p>{formatWeekday(row.dayOfWeek, locale)} · {minToHm(row.startMin)}–{minToHm(row.endMin)}</p><p className="break-all">{t("assignmentTutor", { before: row.tutorId, after: reviewedSelection?.tutorIds?.includes(row.tutorId) ? preview.activeTutorId ?? row.tutorId : row.tutorId })}</p><p className="break-all">{t("assignmentTutees", { before: row.tuteeIds.join(", "), after: row.tuteeIds.map((id) => reviewedSelection?.tuteeIds?.includes(id) ? preview.activeTuteeId ?? id : id).join(", ") })}</p><p className="break-all">{t("room", { id: row.roomId ?? t("none") })}</p></li>)}</ul></section>
        <section><h4 className="font-semibold">{t("publishedWork")}</h4><p className="text-sm">{t("publishedHelp")}</p>{!preview.publishedWork.length && <p className="muted text-sm">{t("noPublished")}</p>}<ul className="mt-2 space-y-3">{preview.publishedWork.map((row) => <li key={row.planId} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="break-all">{t("recordReference", { id: row.planId })} · {row.originalDate}</p><ul className="mt-2 space-y-1">{row.cohorts.map((cohort) => <li key={cohort.id} className="break-all">{cohort.id} · {recordedState(cohort.status)} · {date(cohort.startsAt)}</li>)}</ul><ul className="mt-2 space-y-2">{row.responses.map((response) => <li key={response.id} className="break-all"><p>{response.id} · {recordedState(response.state)}</p><p>{t("responseTimes", { delivered: date(response.deliveredAt), deadline: date(response.deadline) })}</p></li>)}</ul></li>)}</ul></section>
        <section><h4 className="font-semibold">{t("qualifications")}</h4><p className="text-sm">{t("qualificationHelp")}</p><ul className="mt-2 space-y-1">{preview.qualificationTuples.map((row) => <li key={`${row.tutorId}:${row.sourceSubjectId}:${row.subjectId}`} className="break-all text-sm">{t("qualificationTuple", { tutor: row.tutorId, source: row.sourceSubjectId, subject: row.subjectId })}</li>)}</ul>{!preview.qualificationTuples.length && <p className="muted text-sm">{t("noQualifications")}</p>}</section>
        <section><h4 className="font-semibold">{t("preferences")}</h4><p className="break-all text-sm">{t("willingnessResult", { source: sourceName(preview.preferences.willingnessSourceTutorId) })}</p><ul className="mt-2 space-y-1">{preview.preferences.willingness.map((row) => <li key={row.subjectId} className="break-all text-sm">{row.subjectId} · {row.willing ? t("willing") : t("unwilling")}</li>)}</ul><p className="mt-3 break-all text-sm">{t("availabilityResult", { source: sourceName(preview.preferences.availabilitySourceTutorId) })}</p><ul className="mt-2 space-y-1">{preview.preferences.availability.map((row) => <li key={row.slotId} className="break-all text-sm">{row.slotId} · {formatWeekday(row.dayOfWeek, locale)} · {minToHm(row.startMin)}–{minToHm(row.endMin)}</li>)}</ul></section>
        <section><h4 className="font-semibold">{t("intake")}</h4><ul className="mt-2 space-y-3">{preview.intake.map((row) => <li key={row.tuteeId} className="break-all text-sm"><p>{row.tuteeId} · {row.intakeTermId ?? t("notRecorded")}</p><p>{t("submittedAt", { date: date(row.submittedAt) })}</p><ul className="mt-2 space-y-2">{row.surveys.map((survey) => <li key={survey.id}><p>{survey.id} · {survey.intakeTermId}</p><p>{t("surveyDates", { submitted: date(survey.submittedAt), assigned: date(survey.firstAssignedAt) })}</p></li>)}</ul></li>)}</ul></section>
      </div>} consequences={<p className="text-sm">{t("consequences")}</p>} acknowledgement={<div className="space-y-3"><label className="block"><span className="label">{common("evidence")}</span><textarea className="input w-full" rows={3} minLength={10} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); setAcknowledged(false); }} /></label><label className="block"><span className="label">{common("password")}</span><input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("acknowledge")}</span></label></div>} actions={<Button variant="primary" disabled={disabled || !preview.canTransfer || !acknowledged || reason.trim().length < 10 || !password} onClick={() => void commit()}>{saving ? common("loading") : t(preview.discipline.willRemove ? "confirmRemoval" : "confirm")}</Button>} /></fieldset>}
    </>}
  </div>;
}
