"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { parseProgramDateTime, programDateTimeInput } from "~/lib/program-time";
import { programTimeZoneInputLabel } from "~/lib/program-time-zone-label";
import { queuedApprovalId } from "~/lib/approval-outcome";
import type { RecruitmentAudience } from "~/lib/recruitment";
import { sameNextRecruitmentTarget, type NextRecruitmentPreparationEvidence } from "~/lib/next-recruitment";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";
import { NextRecruitmentReview } from "./next-recruitment-review";

export type NextRecruitmentSettingsData = RouterOutputs["program"]["nextRecruitment"];

/** Only the affected audience belongs to an editor's optimistic-concurrency scope. */
function editorIdentity(data: NextRecruitmentSettingsData, audience: RecruitmentAudience) {
  return JSON.stringify({ target: data.target, timeZone: data.timeZone, row: data.preparations[audience] });
}

export function NextRecruitmentError({ message }: { message: string }) {
  const t = useTranslations("nextRecruitment");
  const key = message.startsWith("NEXT_RECRUITMENT_") ? message : null;
  return <>{key && t.has(`errors.${key}`) ? t(`errors.${key}`) : message}</>;
}

/** The page grants entry; the query independently supplies live editing authority. */
export function NextRecruitmentSettings() {
  const t = useTranslations("nextRecruitment");
  const query = api.program.nextRecruitment.useQuery();
  const denied = useSessionAccessDenied(query);
  if (denied) return <StatePanel kind="denied" title={t("readOnly")} />;
  if (!query.data)
    return <StatePanel kind={query.error ? "error" : "loading"} title={t(query.error ? "loadFailed" : "loading")} action={query.error && <button className="btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("retry")}</button>} />;
  return (
    <section className="space-y-4" aria-label={t("title")}>
      <div>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1 text-sm">{t("help")}</p>
      </div>
      {query.error && <InlineNotice tone="error" announcement="alert" action={<button className="btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{t("retry")}</button>}>{t("loadFailed")}</InlineNotice>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {(["tutor", "tutee"] as const).map((audience) => <NextRecruitmentEditor key={audience} audience={audience} data={query.data!} readFailed={!!query.error} />)}
      </div>
    </section>
  );
}

/** Draft, version, target and conversion zone move together only after an explicit
 * reload or a confirmed save. Background cache arrivals never rewrite local work. */
export function NextRecruitmentEditor({ audience, data, readFailed = false }: { audience: RecruitmentAudience; data: NextRecruitmentSettingsData; readFailed?: boolean }) {
  const t = useTranslations("nextRecruitment");
  const approvalText = useTranslations("approvals");
  const locale = useLocale();
  const inputId = useId();
  const utils = api.useUtils();
  const mutation = api.program.prepareNextRecruitment.useMutation();
  const [snapshot, setSnapshot] = useState(data);
  const row = snapshot.preparations[audience];
  const initialInput = (value: NextRecruitmentSettingsData) => {
    const opensAt = value.preparations[audience]?.opensAt;
    return opensAt ? programDateTimeInput(new Date(opensAt), value.timeZone) : "";
  };
  const [opening, setOpening] = useState(() => initialInput(data));
  const [hasOpening, setHasOpening] = useState(!!row?.opensAt);
  const [acknowledgedTarget, setAcknowledgedTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedTarget, setSavedTarget] = useState("");
  const [approvalId, setApprovalId] = useState<string>();
  const [needsRead, setNeedsRead] = useState(false);
  const [readChanged, setReadChanged] = useState(false);
  const admitted = useRef(false);
  const accepted = useRef<NextRecruitmentPreparationEvidence | null>(null);
  const changed = editorIdentity(data, audience) !== editorIdentity(snapshot, audience);
  const staleBinding = !!row && !row.matchesTarget && !acknowledgedTarget;
  const blocked = !data.canEdit || readFailed || busy || needsRead || changed || staleBinding || !!approvalId;

  const adopt = (fresh: NextRecruitmentSettingsData) => {
    setSnapshot(fresh);
    setOpening(initialInput(fresh));
    setHasOpening(!!fresh.preparations[audience]?.opensAt);
    setAcknowledgedTarget(true);
    setNeedsRead(false);
    setReadChanged(false);
    accepted.current = null;
  };
  const freshRead = async () => {
    // staleTime does not bypass an older in-flight request. Cancel its query
    // lifetime first so a pre-write response cannot fulfill this read boundary.
    await utils.program.nextRecruitment.cancel();
    return utils.program.nextRecruitment.fetch(undefined, { staleTime: 0 });
  };
  const synchronize = (fresh: NextRecruitmentSettingsData, allowReplacement: boolean) => {
    const receipt = accepted.current;
    if (receipt) {
      const latestRow = fresh.preparations[audience];
      const receiptPresent = latestRow && latestRow.version === receipt.version &&
        sameNextRecruitmentTarget(latestRow.target, receipt.target) &&
        latestRow.timeZone === receipt.timeZone &&
        (latestRow.opensAt?.getTime() ?? null) === (receipt.opensAt?.getTime() ?? null);
      const exact = receiptPresent && sameNextRecruitmentTarget(fresh.target, receipt.target) && fresh.timeZone === receipt.timeZone;
      // A newer row or a new active source may supersede the accepted write.
      // Only a deliberate Reload adopts it; automatic synchronization keeps the
      // original draft and receipt visible. Older/same-version mismatches fail closed.
      const superseded = receiptPresent || fresh.target.sourceTermId !== receipt.target.sourceTermId ||
        (latestRow && latestRow.version > receipt.version);
      if (!exact && !(allowReplacement && superseded)) {
        setReadChanged(true);
        throw new Error(t("savedChanged"));
      }
    }
    adopt(fresh);
  };
  const reload = async () => {
    if (admitted.current) return;
    admitted.current = true;
    setBusy(true);
    setError(null);
    try {
      if (approvalId) {
        const input = { requestId: approvalId, page: 0 };
        await utils.approval.list.cancel(input);
        const proposal = (await utils.approval.list.fetch(input, { staleTime: 0 })).rows.find((request) => request.id === approvalId);
        if (!proposal) throw new Error(t("loadFailed"));
        // A successful settings read cannot resolve a proposal. Preserve its
        // exact draft and link until the owning approval reports a terminal state.
        if (proposal.state === "PENDING") return;
        if (!["APPROVED", "REJECTED", "CANCELLED"].includes(proposal.state)) throw new Error(t("loadFailed"));
      }
      synchronize(await freshRead(), readChanged);
      setApprovalId(undefined);
      if (!needsRead) setSaved(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("loadFailed"));
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    // A ref closes the same-event-turn gap before React disables the fieldset.
    if (admitted.current || accepted.current || blocked) return;
    let opensAt: Date | null;
    try {
      opensAt = hasOpening ? parseProgramDateTime(opening, snapshot.timeZone) : null;
    } catch {
      setError(t("invalidTime"));
      return;
    }
    admitted.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      accepted.current = await mutation.mutateAsync({ audience, expectedTarget: snapshot.target, expectedVersion: row?.version ?? 0, expectedTimeZone: snapshot.timeZone, opensAt });
    } catch (failure) {
      const queued = queuedApprovalId(failure);
      if (queued) setApprovalId(queued);
      else setError(failure instanceof Error ? failure.message : t("saveFailed"));
      admitted.current = false;
      setBusy(false);
      return;
    }
    // Acceptance is permanent until a successful read establishes a fresh save
    // boundary. A failed follow-up read must never replay this mutation.
    setSaved(true);
    setSavedTarget(snapshot.nextName);
    setNeedsRead(true);
    try {
      synchronize(await freshRead(), false);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === t("savedChanged") ? failure.message : t("savedReadFailed"));
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="card overflow-hidden" aria-label={t(audience)}>
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">{t(audience)}</h3>
        <p className="muted mt-1 text-sm">{t("destination", { name: snapshot.nextName })}</p>
      </div>
      <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <NextRecruitmentReview snapshot={snapshot} audience={audience} compact />
        {!data.canEdit && <p className="muted text-sm">{t("readOnly")}</p>}
        {data.canEdit && !data.canApply && <p className="muted text-sm">{approvalText("sensitiveHelp")}</p>}
        {(changed || staleBinding) && <InlineNotice tone="warning" announcement="status">{t(staleBinding ? "staleBinding" : "changed")}</InlineNotice>}
        <fieldset className="relative min-w-0 space-y-3" disabled={blocked}>
          <legend className="sr-only">{t(audience)}</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium lg:min-h-10">
            <input type="checkbox" checked={hasOpening} onChange={(event) => { setHasOpening(event.target.checked); setSaved(false); }} />
            {t("setOpening")}
          </label>
          {hasOpening ? <div className="space-y-1">
            <label className="label" htmlFor={inputId}>{t("opening")}</label>
            <input id={inputId} type="datetime-local" className="input min-h-11 min-w-0 lg:min-h-10" required value={opening} aria-describedby={`${inputId}-zone`} onChange={(event) => { setOpening(event.target.value); setSaved(false); }} />
            <p id={`${inputId}-zone`} className="muted text-xs">{programTimeZoneInputLabel(opening, snapshot.timeZone, locale)}</p>
          </div> : <p className="muted text-sm">{t("clearHelp")}</p>}
          <p className="muted text-sm">{t("elapsedHelp")}</p>
          {data.canEdit && <button className="btn-primary min-h-11 lg:min-h-10">{busy ? t("saving") : !data.canApply ? approvalText("requestHead") : hasOpening ? t("save") : t("clear")}</button>}
        </fieldset>
        {approvalId && <InlineNotice tone="warning" announcement="status"><p>{t("queued")}</p><Link className="link inline-flex min-h-11 items-center lg:min-h-10" href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}>{t("viewRequest")}</Link></InlineNotice>}
        {error && <InlineNotice tone="error" announcement="alert"><NextRecruitmentError message={error} /></InlineNotice>}
        {saved && <div role="status" className="space-y-1 text-sm text-green-700"><p>{t("savedForTarget", { name: savedTarget })}</p><p>{t(needsRead ? "savedPendingRead" : "saved")}</p></div>}
        <button type="button" className="btn-secondary min-h-11 lg:min-h-10" disabled={busy} onClick={() => void reload()}>{t(approvalId ? "checkApproval" : needsRead && !readChanged ? "retryRead" : "reload")}</button>
        <p className="muted text-xs">{t(approvalId ? "pendingReloadHelp" : "reloadHelp")}</p>
      </form>
    </section>
  );
}
