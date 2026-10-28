"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { nameDraft, personNameEdit, unsplitLegacyName } from "~/lib/person-name";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { ConfiguredPersonNameFields } from "./person-name-fields";
import { ProfileDialog } from "./profile-dialog";
import { ProfilePolicyError } from "./profile-policy-error";
import { useProfileReloadFocus } from "./use-profile-reload-focus";
import { useSessionAccessDenied } from "./session-view-state";
import { Button } from "./ui/button";
import { useDialogPending } from "./ui/modal";
import { InlineNotice, StatePanel } from "./ui/patterns";

type IdentitySnapshot = RouterOutputs["admin"]["applicationIdentity"];
type Names = IdentitySnapshot["current"];
type Props = {
  applicationId: string;
  canCorrect: boolean;
  canApply: boolean;
  invalid: boolean;
  onChanged: (reportErrors?: boolean) => Promise<unknown> | void;
  onActive: (active: boolean) => void;
};

/** Render recorded evidence verbatim, distinguishing missing from deliberately blank.
 * A display label is never parsed into a suggested First or Last Name. */
function RecordedNames({ value, title }: { value: Names; title: string }) {
  const t = useTranslations("applicationIdentity");
  const fields = useTranslations("personName");
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="font-semibold text-slate-900">{title}</h4>
      <dl className="mt-2 space-y-2 text-sm">
        {(["name", "firstName", "lastName", "preferredName", "alternativeNames"] as const).map((key) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-slate-500">{key === "name" ? t("recordedLabel") : fields(key)}</dt>
            <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {value[key] == null ? t("notRecorded") : value[key] === "" ? t("blank") : value[key]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Readiness({ snapshot }: { snapshot: IdentitySnapshot }) {
  const t = useTranslations("applicationIdentity");
  return (
    <InlineNotice tone={snapshot.readiness.ready ? "success" : "warning"}>
      <p className="font-semibold">{t(snapshot.readiness.ready ? "ready" : "needsReview")}</p>
      <p className="mt-1">{t(`source.${snapshot.readiness.source}`)}</p>
      {!snapshot.readiness.ready && <p className="mt-1">{t("needsReviewHelp")}</p>}
      {!snapshot.readiness.ready && snapshot.readiness.reason && <p className="mt-1"><IdentityError message={snapshot.readiness.reason} /></p>}
      <p className="mt-1">{t("notAcceptance")}</p>
    </InlineNotice>
  );
}

/** Private evidence is fetched only after the application details open. The page
 * never mounts this reader for observers; the endpoint independently checks access. */
export function ApplicationIdentityCorrection(props: Props) {
  const t = useTranslations("applicationIdentity");
  const format = useFormatter();
  const query = api.admin.applicationIdentity.useQuery({ applicationId: props.applicationId });
  const denied = useSessionAccessDenied(query);
  const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(false);
  const snapshot = query.data;
  if (denied) return <StatePanel kind="denied" title={t("accessDenied")} />;
  if (!snapshot) return (
    <div className="mt-4">
      <StatePanel
        kind={query.error ? "error" : "loading"}
        title={t(query.error ? "loadFailed" : "loading")}
        action={query.error ? <Button onClick={() => void query.refetch()}>{t("retryRead")}</Button> : undefined}
      />
    </div>
  );
  return (
    <section className="mt-4 space-y-4 border-t border-slate-100 pt-4" aria-label={t("title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="section-title">{t("title")}</h3>
        {props.canCorrect && snapshot.eligible && (
          <Button size="compact" disabled={!!query.error || query.isFetching} onClick={() => { setStarted(true); setOpen(true); }}>
            {t("edit")}
          </Button>
        )}
      </div>
      {query.error && <InlineNotice tone="error" announcement="alert" action={<Button size="compact" onClick={() => void query.refetch()}>{t("retryRead")}</Button>}>{t("readFailedRetained")}</InlineNotice>}
      <Readiness snapshot={snapshot} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <RecordedNames value={snapshot.original} title={t("original")} />
        <RecordedNames value={snapshot.current} title={t("current")} />
      </div>
      <p className="muted text-sm">{t("protectedEvidence")}</p>
      {!snapshot.eligible && <InlineNotice>{t(`ineligible.${snapshot.ineligibleReason ?? "APPLICATION_IDENTITY_NOT_OPEN"}`)}</InlineNotice>}
      {!props.canCorrect && <p className="muted text-sm">{t("readOnly")}</p>}
      {props.invalid && <InlineNotice tone="warning">{t("invalidPreserved")}</InlineNotice>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold lg:min-h-8 lg:py-1">{t("history", { count: snapshot.history.length })}</summary>
        {snapshot.history.length === 0 ? <p className="muted mt-2 text-sm">{t("noHistory")}</p> : (
          <ol className="mt-3 space-y-3">
            {snapshot.history.map((entry) => (
              <li key={entry.revision} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-semibold">{t("revision", { revision: entry.revision, actor: entry.actorName, date: format.dateTime(entry.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.reason}</p>
                <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                  <RecordedNames value={historyNames(entry.before)} title={t("before")} />
                  <RecordedNames value={historyNames(entry.after)} title={t("after")} />
                </div>
                {entry.approvalId && <Link className="link inline-flex min-h-11 items-center lg:min-h-8" href={`/admin/approvals?request=${encodeURIComponent(entry.approvalId)}`}>{t("viewRequest")}</Link>}
              </li>
            ))}
          </ol>
        )}
      </details>
      {started && (
        <IdentityCorrectionEditor {...props} initial={snapshot} open={open} onClose={() => setOpen(false)} readFailed={!!query.error} readPending={query.isFetching} />
      )}
    </section>
  );
}

/** One owner retains the draft, expected revision and receipt key across Close,
 * rejected writes and failed reads. Background query updates never adopt a draft. */
function IdentityCorrectionEditor({
  initial, open, onClose, readFailed, readPending, onActive, ...props
}: Props & { initial: IdentitySnapshot; open: boolean; onClose: () => void; readFailed: boolean; readPending: boolean }) {
  const t = useTranslations("applicationIdentity");
  const utils = api.useUtils();
  const [snapshot, setSnapshot] = useState(initial);
  const [names, setNames] = useState(() => nameDraft(initial.current));
  const [reason, setReason] = useState("");
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [accepted, setAccepted] = useState<"applied" | "queued" | null>(null);
  const [approvalId, setApprovalId] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [namePolicyReady, setNamePolicyReady] = useState(false);
  const inFlight = useRef(false);
  const committed = useRef(false);
  // A response can be lost after commit. Reuse the key only for the identical
  // versioned payload; a deliberate draft change starts a distinct operation.
  const lastPayload = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reloadFocus = useProfileReloadFocus(formRef, reloading);
  const save = api.admin.correctApplicationIdentity.useMutation();
  const originalNames = nameDraft(snapshot.current);
  const legacyName = unsplitLegacyName(snapshot.current);
  const identity = personNameEdit(names, originalNames, legacyName);
  useEffect(() => {
    onActive(open || writing || needsRefresh);
    return () => onActive(false);
  }, [open, writing, needsRefresh, onActive]);

  const adopt = (latest: IdentitySnapshot) => {
    setSnapshot(latest);
    setNames(nameDraft(latest.current));
    setReason("");
    setClientKey(crypto.randomUUID());
    lastPayload.current = null;
    setError(null);
  };
  const refresh = async (afterWrite: boolean, outcome = accepted) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReloading(true);
    setRefreshError(null);
    reloadFocus.beginReload();
    let succeeded = false;
    try {
      let latest: IdentitySnapshot | undefined;
      let proposalComplete = false;
      // Wait for every affected read before releasing the form. A failed list
      // refresh must not turn a committed correction into another mutation.
      await settleRefreshes([
        async () => { latest = await utils.admin.applicationIdentity.fetch({ applicationId: props.applicationId }, { staleTime: 0 }); },
        async () => { await utils.program.nameFieldPolicy.fetch(undefined, { staleTime: 0 }); },
        ...(afterWrite ? [async () => { await props.onChanged(true); }] : []),
        ...(outcome === "queued" && !afterWrite && approvalId ? [async () => {
          const review = await utils.approval.list.fetch({ requestId: approvalId, page: 0 }, { staleTime: 0 });
          const proposal = review.rows.find((row) => row.id === approvalId);
          if (!proposal) throw new Error(t("loadFailed"));
          proposalComplete = proposal.state !== "PENDING";
        }] : []),
      ]);
      if (latest?.id !== props.applicationId) throw new Error(t("loadFailed"));
      if (outcome !== "queued") adopt(latest);
      else if (!afterWrite && proposalComplete) {
        // Explicit Reload after a reviewed proposal may begin a new correction.
        adopt(latest);
        setAccepted(null);
        setApprovalId(undefined);
        committed.current = false;
      }
      setNeedsRefresh(false);
      if (outcome !== "queued") committed.current = false;
      succeeded = true;
    } catch (failure) {
      setRefreshError(failure instanceof Error ? failure.message : t("loadFailed"));
    } finally {
      inFlight.current = false;
      setReloading(false);
      reloadFocus.finishReload(succeeded);
    }
  };
  const submit = async () => {
    if (inFlight.current || committed.current || !props.canCorrect || !snapshot.eligible || !initial.eligible || readFailed || readPending || !namePolicyReady) return;
    const payload = { id: props.applicationId, expectedUpdatedAt: snapshot.expectedUpdatedAt, ...identity.fields, reason: reason.trim() };
    const signature = JSON.stringify(payload);
    const key = lastPayload.current && lastPayload.current !== signature ? crypto.randomUUID() : clientKey;
    lastPayload.current = signature;
    setClientKey(key);
    inFlight.current = true;
    setWriting(true);
    setError(null);
    setRefreshError(null);
    let outcome: "applied" | "queued" | null = null;
    try {
      await save.mutateAsync({ ...payload, clientKey: key });
      outcome = "applied";
    } catch (failure) {
      const queued = queuedApprovalId(failure);
      if (queued) { outcome = "queued"; setApprovalId(queued); }
      else setError(failure);
    } finally {
      inFlight.current = false;
      setWriting(false);
    }
    if (outcome) {
      committed.current = true;
      setAccepted(outcome);
      setNeedsRefresh(true);
      await refresh(true, outcome);
    }
  };
  const feedback = (
    <>
      {accepted && <InlineNotice tone={accepted === "queued" ? "warning" : "success"} announcement="status">
        <p className="font-semibold">{t(accepted)}</p>
        <p className="mt-1">{t(accepted === "queued" ? "queuedHelp" : "appliedHelp")}</p>
        {approvalId && <Link className="link inline-flex min-h-11 items-center lg:min-h-8" href={`/admin/approvals?request=${encodeURIComponent(approvalId)}`}>{t("viewRequest")}</Link>}
      </InlineNotice>}
      {refreshError && <InlineNotice tone="error" announcement="alert"><p>{needsRefresh ? t("acceptedReadFailed") : t("reloadFailed")}</p><p className="mt-1">{refreshError}</p></InlineNotice>}
    </>
  );
  return (
    <>
      {!open && (accepted !== null || Boolean(refreshError)) && <div className="space-y-3">{feedback}{needsRefresh && <Button disabled={reloading} onClick={() => void refresh(true)}>{t("retryRead")}</Button>}</div>}
      {open && <ProfileDialog title={t("dialogTitle")} onClose={onClose} pending={writing}>
        <CorrectionForm busy={writing} formRef={formRef} submit={() => void submit()}>
          <p className="muted text-sm">{t("editHelp")}</p>
          {feedback}
          {!props.canCorrect && <InlineNotice tone="warning">{t("authorityChanged")}</InlineNotice>}
          {!initial.eligible && <InlineNotice tone="warning">{t(`ineligible.${initial.ineligibleReason ?? "APPLICATION_IDENTITY_NOT_OPEN"}`)}</InlineNotice>}
          {readFailed && <InlineNotice tone="error">{t("readFailedRetained")}</InlineNotice>}
          <fieldset disabled={writing || reloading || needsRefresh || accepted === "queued" || !props.canCorrect || !initial.eligible || readFailed || readPending} className="min-w-0 space-y-4">
            <RecordedNames value={snapshot.original} title={t("original")} />
            <ConfiguredPersonNameFields accountType="TUTOR" management preserveLegacyRequiredFields value={names} originalValue={originalNames} legacyName={legacyName} onChange={(next) => { setNames(next); setAccepted(null); }} onPolicyAvailabilityChange={setNamePolicyReady} />
            {identity.preserved && <InlineNotice tone="warning">{t("legacyRetained")}</InlineNotice>}
            <ReasonField value={reason} onChange={(next) => { setReason(next); setAccepted(null); }} />
            <p className="muted text-sm">{t("protectedEvidence")}</p>
            {props.invalid && <InlineNotice tone="warning">{t("invalidPreserved")}</InlineNotice>}
            {!accepted && <Button type="submit" variant="primary" disabled={!namePolicyReady || !reason.trim()}>{t(props.canApply ? "apply" : "propose")}</Button>}
          </fieldset>
          {error != null && <p role="alert" className="text-sm text-red-700"><IdentityError message={error instanceof Error ? error.message : t("saveFailed")} /></p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Button disabled={writing || reloading} onClick={() => void refresh(needsRefresh)}>{t(needsRefresh ? "retryRead" : "reload")}</Button>
            <Button disabled={writing} onClick={onClose}>{t("cancel")}</Button>
          </div>
        </CorrectionForm>
      </ProfileDialog>}
    </>
  );
}

function CorrectionForm({ busy, formRef, submit, children }: { busy: boolean; formRef: React.RefObject<HTMLFormElement | null>; submit: () => void; children: React.ReactNode }) {
  const pending = useDialogPending(busy);
  return <form ref={formRef} className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!pending && event.currentTarget.reportValidity()) submit(); }}>{children}</form>;
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("applicationIdentity");
  const id = useId();
  return <div><label className="label" htmlFor={id}>{t("reason")}</label><textarea id={id} className="input min-h-24 w-full" required maxLength={1000} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`} /><p id={`${id}-help`} className="muted mt-1 text-xs">{t("reasonHelp")}</p></div>;
}

/** Audit JSON is a stored snapshot, not an editable form or guessed name split. */
function historyNames(value: unknown): Names {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const field = (key: string) => typeof record[key] === "string" ? record[key] : null;
  return { name: field("name") ?? "", firstName: field("firstName"), lastName: field("lastName"), preferredName: field("preferredName"), alternativeNames: field("alternativeNames") };
}

function IdentityError({ message }: { message: string }) {
  const t = useTranslations("applicationIdentity");
  if (t.has(`errors.${message}`)) return t(`errors.${message}`);
  if (t.has(`ineligible.${message}`)) return t(`ineligible.${message}`);
  return <ProfilePolicyError message={message} />;
}
