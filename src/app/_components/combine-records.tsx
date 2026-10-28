"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "./ui/button";
import {
  ChangeReview,
  FormSection,
  InlineNotice,
  StatePanel,
} from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SummaryTable, TableAction, TableActions } from "./ui/summary-table";
import { useDialogPending } from "./ui/modal";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { PersonParticipationReview } from "./person-participation-review";
import { HistoricalRecordInvitation, type HistoricalInvitationSource } from "./historical-record-invitation";
import { DisclosureSection } from "./ui/disclosure-section";

type Preview = RouterOutputs["personCombine"]["preview"];
type Receipt = RouterOutputs["personCombine"]["combine"];
type PendingInvitation = { id: string; sources: HistoricalInvitationSource[] };
export type CombineRecordSource = {
  kind: "USER" | "TUTOR" | "TUTEE";
  id: string;
  name: string;
};
type SelectedRecord = {
  ref: Pick<CombineRecordSource, "kind" | "id">;
  name: string;
};
const keyOf = (ref: SelectedRecord["ref"]) => `${ref.kind}:${ref.id}`;
function isDenied(error: unknown) {
  const value = error as { data?: { code?: string } } | null;
  return ["FORBIDDEN", "UNAUTHORIZED"].includes(value?.data?.code ?? "");
}

/** One identity review accepts logins and roster records alike. Grouping preserves
 * original evidence; retiring credentials is a separate, explicit Head choice. */
export function CombineRecords({
  canApply,
  initialSource,
  reviewPersonId,
  onPendingChange,
  unavailable = false,
  accessDenied = false,
}: {
  canApply: boolean;
  initialSource?: CombineRecordSource;
  /** Existing groups use a fresh read and an explicit finalization, never a second grouping. */
  reviewPersonId?: string;
  onPendingChange?: (pending: boolean) => void;
  /** A parent's failed permission refresh preserves the receipt/draft lifetime. */
  unavailable?: boolean;
  accessDenied?: boolean;
}) {
  const t = useTranslations("combineRecords");
  const common = useTranslations("uiPatterns");
  const regionId = useId();
  const utils = api.useUtils();
  const initial = (): SelectedRecord[] =>
    initialSource
      ? [
          {
            ref: { kind: initialSource.kind, id: initialSource.id },
            name: initialSource.name,
          },
        ]
      : [];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedRecord[]>(initial);
  const [retainedUserId, setRetainedUserId] = useState<string | undefined>();
  const [retireDuplicateLogins, setRetireDuplicateLogins] = useState(false);
  const [accounts, setAccounts] = useState<Preview["accounts"]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [pendingInvitationScopes, setPendingInvitationScopes] = useState<ReadonlySet<string>>(() => new Set());
  const invitationPendingChanged = useCallback((scopeId: string, pending: boolean) => {
    setPendingInvitationScopes((current) => {
      if (current.has(scopeId) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(scopeId);
      else next.delete(scopeId);
      return next;
    });
  }, []);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [admitted, setAdmitted] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [checkingOutcome, setCheckingOutcome] = useState(false);
  const [missingReceipt, setMissingReceipt] = useState(false);
  const [submittedOperation, setSubmittedOperation] = useState<string | null>(
    null,
  );
  const [accessLost, setAccessLost] = useState(false);
  const admission = useRef(false);
  const readAdmission = useRef(false);
  const refreshAdmission = useRef(false);
  const accepted = useRef(false);
  const reviewGeneration = useRef(0);
  // An identical failed submission reuses its durable operation ID; a new review
  // establishes another intent. The server rejects reuse with changed evidence.
  const operationId = useRef<string | null>(null);
  const candidates = api.personCombine.candidates.useQuery(
    { search: query },
    { enabled: open && !reviewPersonId },
  );
  const refresh = async () => {
    if (refreshAdmission.current) return;
    refreshAdmission.current = true;
    setSyncing(true);
    try {
      await settleRefreshes([
        () => invalidateAndReport(utils.admin.accounts),
        () => invalidateAndReport(utils.admin.accountDetails),
        () => invalidateAndReport(utils.admin.tutors),
        () => invalidateAndReport(utils.admin.tutees),
        () => invalidateAndReport(utils.tuteeHistory),
        () => invalidateAndReport(utils.historicalAcademics),
        () => invalidateAndReport(utils.personCombine.candidates),
      ]);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshAdmission.current = false;
      setSyncing(false);
    }
  };
  const callbacks = {
    onSuccess: async (result: Receipt) => {
      accepted.current = true;
      setReceipt(result);
      setOutcomeUnknown(false);
      setPreview(null);
      setPassword("");
      setAcknowledged(false);
      await refresh();
    },
    onError: (failure: { message: string; data?: { code?: string } | null }) => {
      const definiteRejection = [
        "BAD_REQUEST",
        "CONFLICT",
        "PRECONDITION_FAILED",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "TOO_MANY_REQUESTS",
      ].includes(failure.data?.code ?? "");
      setOutcomeUnknown(!definiteRejection);
      setMissingReceipt(false);
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(failure.data?.code ?? ""))
        setAccessLost(true);
      setError(failure.message);
      setPassword("");
      setAcknowledged(false);
    },
    onSettled: () => {
      admission.current = false;
      setAdmitted(false);
    },
  };
  const groupMutation = api.personCombine.combine.useMutation(callbacks);
  const finalizeMutation = api.personCombine.finalize.useMutation(callbacks);
  const combine = reviewPersonId ? finalizeMutation : groupMutation;
  const ownPending = admitted || combine.isPending || syncing;
  const invitationPending = pendingInvitationScopes.size > 0;
  // An unresolved response keeps the parent and siblings locked. Its own receipt
  // read / exact retry remain usable, so it must not disable its own recovery.
  const dismissalPending = ownPending || outcomeUnknown || invitationPending;
  const aggregatePending = useDialogPending(dismissalPending);
  const busy = ownPending || invitationPending || (!outcomeUnknown && aggregatePending);
  useEffect(() => {
    onPendingChange?.(dismissalPending);
    return () => onPendingChange?.(false);
  }, [dismissalPending, onPendingChange]);
  const currentDenial =
    accessDenied ||
    (!reviewPersonId && ["UNAUTHORIZED", "FORBIDDEN"].includes(candidates.error?.data?.code ?? ""));
  const denied = accessLost || currentDenial;
  useEffect(() => {
    if (currentDenial) {
      setAccessLost(true);
      reviewGeneration.current++;
    }
    else if (
      !reviewPersonId &&
      candidates.isSuccess &&
      !candidates.isFetching &&
      !candidates.error &&
      !unavailable
    )
      setAccessLost(false);
  }, [
    currentDenial,
    candidates.isSuccess,
    candidates.isFetching,
    candidates.error,
    unavailable,
    reviewPersonId,
  ]);
  const disabled =
    busy ||
    reviewing ||
    checkingOutcome ||
    outcomeUnknown ||
    !!receipt ||
    denied ||
    unavailable;
  async function checkOutcome() {
    if (!submittedOperation || checkingOutcome || readAdmission.current) return;
    readAdmission.current = true;
    setCheckingOutcome(true);
    try {
      const result = await utils.personCombine.receipt.fetch(
        { operationId: submittedOperation },
        { staleTime: 0 },
      );
      if (result) {
        accepted.current = true;
        setReceipt(result);
        setPreview(null);
        setPassword("");
        setAcknowledged(false);
        setOutcomeUnknown(false);
        setError(null);
        await refresh();
      } else setMissingReceipt(true);
    } catch (failure) {
      if (isDenied(failure)) setAccessLost(true);
      setError(failure instanceof Error ? failure.message : t("failed"));
    } finally {
      readAdmission.current = false;
      setCheckingOutcome(false);
    }
  }
  function resetReview() {
    reviewGeneration.current++;
    setPreview(null);
    setAcknowledged(false);
    setPassword("");
    setError(null);
    setSubmittedOperation(null);
    setMissingReceipt(false);
    operationId.current = null;
  }
  function changeSelection(person: SelectedRecord) {
    if (disabled || admission.current || readAdmission.current) return;
    const exists = selected.some(
      (entry) => keyOf(entry.ref) === keyOf(person.ref),
    );
    if (!exists && selected.length >= 20) return;
    resetReview();
    setAccounts([]);
    setRetainedUserId(undefined);
    setRetireDuplicateLogins(false);
    setSelected((current) =>
      current.some((entry) => keyOf(entry.ref) === keyOf(person.ref))
        ? current.filter((entry) => keyOf(entry.ref) !== keyOf(person.ref))
        : current.length < 20
          ? [...current, person]
          : current,
    );
  }
  async function review(recoverAccess = false) {
    if (
      (recoverAccess ? busy || reviewing || checkingOutcome || outcomeUnknown || !!receipt : disabled) ||
      admission.current ||
      readAdmission.current ||
      (!reviewPersonId && selected.length < 2)
    )
      return;
    readAdmission.current = true;
    resetReview();
    const generation = reviewGeneration.current;
    setReviewing(true);
    try {
      const result = reviewPersonId
        ? await utils.personCombine.review.fetch(
            { personId: reviewPersonId, retainedUserId, retireDuplicateLogins },
            { staleTime: 0 },
          )
        : await utils.personCombine.preview.fetch(
            {
              sources: selected.map((row) => row.ref),
              retainedUserId,
              retireDuplicateLogins,
            },
            { staleTime: 0 },
          );
      if (generation !== reviewGeneration.current) return;
      setAccessLost(false);
      setPreview(result);
      // A grant belongs to its originally reviewed scope. Retain that controller
      // across fresh group reads so new members cannot expand a cancellation or
      // discard an accepted action's read-only recovery.
      const invitations = (result.blockers ?? []).flatMap((item) => {
        if (item.reason !== "PENDING_HISTORY_INVITATION" || !item.sources.length) return [];
        const sources = item.sources.flatMap((source) =>
          source.kind === "TUTOR" || source.kind === "TUTEE"
            ? [{ kind: source.kind, id: source.id }]
            : [],
        );
        // Never silently truncate a malformed source set to another valid scope.
        if (sources.length !== item.sources.length) return [];
        return item.work.filter((work) => work.kind === "HISTORICAL_RECORD_INVITATION")
          .map((work) => ({ id: work.id, sources }));
      });
      setPendingInvitations((current) => [
        ...current,
        ...invitations.filter((item) => !current.some((known) => known.id === item.id)),
      ]);
      if (reviewPersonId) setSelected(result.sources);
      setAccounts(result.accounts);
      setRetainedUserId(result.retainedUserId ?? undefined);
    } catch (failure) {
      if (isDenied(failure)) setAccessLost(true);
      setError(failure instanceof Error ? failure.message : t("failed"));
    } finally {
      readAdmission.current = false;
      setReviewing(false);
    }
  }
  const resultRows = preview?.sources ?? selected;
  return (
    <section
      className="card min-w-0 overflow-hidden"
      aria-labelledby={`${regionId}-title`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 id={`${regionId}-title`} className="font-semibold">
            {t(reviewPersonId ? "participationTitle" : "title")}
          </h2>
          <p className="muted mt-1 text-sm">{t(reviewPersonId ? "participationIntro" : "intro")}</p>
        </div>
        <Button
          aria-expanded={open}
          aria-controls={regionId}
          disabled={busy || reviewing || checkingOutcome || outcomeUnknown}
          onClick={() => setOpen(!open)}
        >
          {t(open ? "close" : reviewPersonId ? "reviewParticipation" : "open")}
        </Button>
      </div>
      {open && (
        <div id={regionId} className="space-y-5 border-t border-slate-200 p-4">
          {receipt && (
            <InlineNotice
              tone={
                receipt.outcome === "REVIEW_REQUIRED" ? "warning" : "success"
              }
              announcement="status"
            >
              <p>
                {t(
                  receipt.outcome === "REVIEW_REQUIRED"
                    ? "savedPending"
                    : "saved",
                )}
              </p>
              <p className="muted mt-1 text-xs break-all">
                {t("receipt", { id: receipt.receiptId })}
              </p>
            </InlineNotice>
          )}
          {refreshFailed && (
            <InlineNotice
              tone="warning"
              announcement="alert"
              action={
                <Button disabled={busy} onClick={() => void refresh()}>
                  {common("retry")}
                </Button>
              }
            >
              {t("refreshFailed")}
            </InlineNotice>
          )}
          {syncing && <p role="status">{t("refreshing")}</p>}
          {receipt && !refreshFailed && (!reviewPersonId || receipt.outcome === "REVIEW_REQUIRED") && (
            <Button
              disabled={busy}
              onClick={() => {
                accepted.current = false;
                setReceipt(null);
                resetReview();
                setAccounts([]);
                setRetainedUserId(undefined);
                setRetireDuplicateLogins(false);
              }}
            >
              {t(
                receipt.outcome === "REVIEW_REQUIRED"
                  ? "reviewAgain"
                  : "combineMore",
              )}
            </Button>
          )}
          {!receipt && (
            <>
              {submittedOperation && (
                <p className="muted text-xs break-all">
                  {t("operationReference", { id: submittedOperation })}
                </p>
              )}
              {outcomeUnknown && (
                <InlineNotice
                  tone="warning"
                  announcement="alert"
                  action={
                    <Button
                      disabled={checkingOutcome || busy}
                      onClick={() => void checkOutcome()}
                    >
                      {t("checkOutcome")}
                    </Button>
                  }
                >
                  <p>{t("uncertain")}</p>
                  {missingReceipt && (
                    <p className="mt-2">{t("notRecordedYet")}</p>
                  )}
                </InlineNotice>
              )}
              <InlineNotice>{t("scope")}</InlineNotice>
              {reviewPersonId && denied && <StatePanel kind="denied" title={t("denied")}
                action={<Button disabled={busy || reviewing || checkingOutcome} onClick={() => void review(true)}>{common("retry")}</Button>} />}
              {!reviewPersonId && <QueryFeedback
                hasData={!denied && candidates.data !== undefined}
                loading={candidates.isLoading}
                error={denied || !!candidates.error}
                retrying={candidates.isFetching}
                loadingTitle={t("loading")}
                errorTitle={t(denied ? "denied" : "failed")}
                retryLabel={common("retry")}
                onRetry={() => void candidates.refetch()}
              />}
              {!reviewPersonId && <FormSection
                title={t("chooseRecords")}
                description={t("chooseHelp")}
                disabled={disabled}
              >
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!disabled && !readAdmission.current)
                      setQuery(search.trim());
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="label">{t("search")}</span>
                    <input
                      className="input w-full"
                      value={search}
                      maxLength={100}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <Button type="submit">{t("searchAction")}</Button>
                </form>
                {!denied && !!candidates.data?.length && (
                  <SummaryTable label={t("searchResults")}>
                    <thead>
                      <tr>
                        <th>{t("select")}</th>
                        <th>{t("record")}</th>
                        <th>{t("type")}</th>
                        <th>{t("login")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.data.map((person) => (
                        <tr key={keyOf(person.ref)}>
                          <td>
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                aria-label={t("selectRecord", {
                                  name: person.name,
                                  id: person.ref.id,
                                })}
                                checked={selected.some(
                                  (row) => keyOf(row.ref) === keyOf(person.ref),
                                )}
                                disabled={
                                  !selected.some(
                                    (row) =>
                                      keyOf(row.ref) === keyOf(person.ref),
                                  ) && selected.length >= 20
                                }
                                onChange={() => changeSelection(person)}
                                className="h-5 w-5"
                              />
                            </label>
                          </td>
                          <td>
                            <p className="font-medium">{person.name}</p>
                            <p className="muted text-xs break-all">
                              {person.email ?? person.ref.id}
                            </p>
                          </td>
                          <td>
                            {t(`kind.${person.ref.kind}`)}
                            {person.status && (
                              <p className="muted text-xs">
                                {t.has(`status.${person.status}`)
                                  ? t(`status.${person.status}`)
                                  : t("unknownStatus")}
                              </p>
                            )}
                          </td>
                          <td>{t(person.hasLogin ? "hasLogin" : "noLogin")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </SummaryTable>
                )}
                {!denied && candidates.data?.length === 0 && (
                  <StatePanel kind="empty" title={t("noResults")} />
                )}
              </FormSection>}
              {!denied && (
                <FormSection
                  title={t("selected", { count: selected.length })}
                  disabled={disabled}
                >
                  {!!selected.length && (
                    <SummaryTable
                      label={t("selected", { count: selected.length })}
                    >
                      <thead>
                        <tr>
                          <th>{t("record")}</th>
                          <th>{t("type")}</th>
                          <th>{t("actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.map((person) => (
                          <tr key={keyOf(person.ref)}>
                            <td>
                              <p>{person.name}</p>
                              <p className="muted text-xs break-all">
                                {person.ref.id}
                              </p>
                            </td>
                            <td>{t(`kind.${person.ref.kind}`)}</td>
                            <TableActions>
                              {!reviewPersonId && <TableAction
                                onClick={() => changeSelection(person)}
                              >
                                {t("remove")}
                              </TableAction>}
                            </TableActions>
                          </tr>
                        ))}
                      </tbody>
                    </SummaryTable>
                  )}
                  {accounts.length > 0 && (
                    <label className="block">
                      <span className="label">{t("retainedLogin")}</span>
                      <select
                        className="input w-full"
                        value={retainedUserId ?? ""}
                        onChange={(event) => {
                          resetReview();
                          setRetainedUserId(event.target.value || undefined);
                        }}
                      >
                        <option value="">{t("chooseLogin")}</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} · {account.email}
                            {account.ready ? "" : ` · ${t("notReady")}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {canApply && accounts.length > 1 && (
                    <label className="flex min-h-11 items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5"
                        checked={retireDuplicateLogins}
                        onChange={(event) => {
                          resetReview();
                          setRetireDuplicateLogins(event.target.checked);
                        }}
                      />
                      <span>{t("retireLogins")}</span>
                    </label>
                  )}
                  <Button
                    disabled={!reviewPersonId && (selected.length < 2 || selected.length > 20)}
                    onClick={() => void review()}
                  >
                    {reviewing ? t("loading") : t(reviewPersonId ? "refreshParticipation" : "preview")}
                  </Button>
                </FormSection>
              )}
              {error && (
                <InlineNotice tone="error" announcement="alert">
                  {error}
                </InlineNotice>
              )}
              {!denied && preview && (
                <FormSection
                  title={t("review")}
                  disabled={busy || reviewing || checkingOutcome || unavailable}
                >
                  <ChangeReview
                    title={t("result")}
                    evidence={
                      <div className="space-y-3">
                        <p>{t("counts", preview.counts)}</p>
                        <SummaryTable label={t("reviewSources")}>
                          <thead>
                            <tr>
                              <th>{t("record")}</th>
                              <th>{t("type")}</th>
                              <th>{t("reference")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {resultRows.map((row) => (
                              <tr key={keyOf(row.ref)}>
                                <td>{row.name}</td>
                                <td>{t(`kind.${row.ref.kind}`)}</td>
                                <td className="text-xs break-all">
                                  {row.ref.id}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </SummaryTable>
                        <p>
                          {preview.accounts.length
                            ? t("resultLogin", {
                                email:
                                  preview.accounts.find(
                                    (account) =>
                                      account.id === preview.retainedUserId,
                                  )?.email ?? t("chooseLogin"),
                              })
                            : t("resultNoLogin")}
                        </p>
                        <p>
                          {t(
                            preview.requiresHead
                              ? "headAuthority"
                              : "adminAuthority",
                          )}
                        </p>
                        {preview.alreadyTogether && !reviewPersonId && (
                          <InlineNotice>{t("alreadyTogether")}</InlineNotice>
                        )}
                        {preview.retireDuplicateLogins &&
                          !preview.canRetireLogins && (
                            <InlineNotice tone="warning">
                              {t("cannotRetire")}
                            </InlineNotice>
                          )}
                        {preview.blockers ? <PersonParticipationReview blockers={preview.blockers} sources={preview.sources} /> : (preview.conflicts.length > 0 ||
                          preview.warnings.length > 0) && (
                          <InlineNotice tone="warning">
                            <p className="font-semibold">
                              {t("pendingReview")}
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                              {[...preview.conflicts, ...preview.warnings].map(
                                (message, index) => (
                                  <li key={`${index}:${message}`}>{message}</li>
                                ),
                              )}
                            </ul>
                          </InlineNotice>
                        )}
                      </div>
                    }
                    consequences={
                      <p className="muted text-sm">
                        {t(
                          preview.retireDuplicateLogins
                            ? "retirementConsequences"
                            : "groupConsequences",
                        )}
                      </p>
                    }
                    acknowledgement={
                      <div className="space-y-3">
                        <label className="block">
                          <span className="label">{t("evidence")}</span>
                          <textarea
                            className="input w-full"
                            rows={3}
                            minLength={10}
                            maxLength={1000}
                            value={reason}
                            disabled={outcomeUnknown}
                            onChange={(event) => {
                              setReason(event.target.value);
                              setAcknowledged(false);
                              operationId.current = null;
                            }}
                          />
                        </label>
                        <label className="flex min-h-11 items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1 h-5 w-5"
                            checked={acknowledged}
                            onChange={(event) =>
                              setAcknowledged(event.target.checked)
                            }
                          />
                          <span>{t("acknowledge")}</span>
                        </label>
                        {preview.requiresHead && canApply && (
                          <label className="block">
                            <span className="label">{t("password")}</span>
                            <input
                              className="input w-full"
                              type="password"
                              autoComplete="current-password"
                              value={password}
                              onChange={(event) =>
                                setPassword(event.target.value)
                              }
                            />
                          </label>
                        )}
                      </div>
                    }
                    actions={
                      preview.requiresHead && !canApply ? (
                        <InlineNotice tone="warning">
                          {t("headRequired")}
                        </InlineNotice>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={
                            unavailable ||
                            (!!reviewPersonId && preview.outcome === "REVIEW_REQUIRED") ||
                            (outcomeUnknown && !missingReceipt) ||
                            !acknowledged ||
                            reason.trim().length < 10 ||
                            (preview.requiresHead && !password) ||
                            (preview.retireDuplicateLogins &&
                              !preview.canRetireLogins)
                          }
                          onClick={() => {
                            if (
                              unavailable ||
                              (!!reviewPersonId && preview.outcome === "REVIEW_REQUIRED") ||
                              denied ||
                              busy ||
                              reviewing ||
                              checkingOutcome ||
                              (outcomeUnknown && !missingReceipt) ||
                              admission.current ||
                              accepted.current ||
                              !acknowledged ||
                              reason.trim().length < 10 ||
                              (preview.requiresHead &&
                                (!canApply || !password)) ||
                              (preview.retireDuplicateLogins &&
                                !preview.canRetireLogins)
                            )
                              return;
                            admission.current = true;
                            setAdmitted(true);
                            setError(null);
                            operationId.current ??= crypto.randomUUID();
                            setSubmittedOperation(operationId.current);
                            const input = {
                              retainedUserId:
                                preview.retainedUserId ?? undefined,
                              retireDuplicateLogins:
                                preview.retireDuplicateLogins,
                              fingerprint: preview.fingerprint,
                              reason,
                              acknowledged: true as const,
                              operationId: operationId.current,
                              ...(preview.requiresHead
                                ? { confirmPassword: password }
                                : {}),
                            };
                            if (reviewPersonId) {
                              finalizeMutation.mutate({ ...input, personId: reviewPersonId });
                            } else {
                              groupMutation.mutate({ ...input, sources: selected.map((row) => row.ref) });
                            }
                          }}
                        >
                          {t(
                            outcomeUnknown
                              ? "retryExact"
                              : reviewPersonId
                                ? "finalizeParticipation"
                                : preview.outcome === "REVIEW_REQUIRED"
                                ? "confirmPending"
                                : "confirm",
                          )}
                        </Button>
                      )
                    }
                  />
                </FormSection>
              )}
            </>
          )}
        </div>
      )}
      {pendingInvitations.length > 0 && (
        <div hidden={!open || denied} className="space-y-3 border-t border-slate-200 p-4">
          {pendingInvitations.map((invitation) => (
            <PendingInvitationDisclosure
              key={invitation.id}
              invitation={invitation}
              accessDenied={denied}
              unavailable={unavailable || ownPending || reviewing || checkingOutcome || outcomeUnknown || !!receipt ||
                pendingInvitationScopes.size > (pendingInvitationScopes.has(invitation.id) ? 1 : 0)}
              onCancelled={resetReview}
              onPendingChange={invitationPendingChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Keep each reporting callback stable, and exclude this scope's own pending
 * state from its unavailable prop so receipt reads never disable themselves. */
function PendingInvitationDisclosure({ invitation, accessDenied, unavailable, onCancelled, onPendingChange }: {
  invitation: PendingInvitation;
  accessDenied: boolean;
  unavailable: boolean;
  onCancelled: () => void;
  onPendingChange: (scopeId: string, pending: boolean) => void;
}) {
  const t = useTranslations("combineRecords");
  const reportPending = useCallback((pending: boolean) => {
    onPendingChange(invitation.id, pending);
  }, [invitation.id, onPendingChange]);
  return (
    <DisclosureSection title={t("pendingInvitation")} lifetime="retained">
      <p className="muted mb-3 text-sm">{t("pendingInvitationHelp")}</p>
      <ul className="mb-3 space-y-1 text-sm">
        {invitation.sources.map((source) => <li key={keyOf(source)}>
          {t(`kind.${source.kind}`)} · <span className="break-all">{source.id}</span>
        </li>)}
      </ul>
      <HistoricalRecordInvitation
        sources={invitation.sources}
        accessDenied={accessDenied}
        unavailable={unavailable}
        onCancelled={onCancelled}
        onPendingChange={reportPending}
      />
    </DisclosureSection>
  );
}
