"use client";
import { invalidateTuteeViews } from "~/lib/tutee-cache";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { AcademicDetails } from "./academic-profile";
import { InlineNotice, ScrollTable } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { HistoricalAcademicEvidence } from "./historical-academic-evidence";
import { Button } from "./ui/button";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useHistoryReadDenial } from "~/app/history/use-history-read-denial";

/** Only an authoritative permission response conceals cached private delivery evidence. */
function historyAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { message?: string; data?: { code?: string } };
  return ["FORBIDDEN", "UNAUTHORIZED"].some(
    (code) => value.data?.code === code || value.message === code,
  );
}

export function HistoryError({ message }: { message: string }) {
  const t = useTranslations("tuteeHistory");
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      {message === "SIGNUP_RETRY"
        ? t("HISTORY_RATE_LIMIT")
        : t.has(message)
          ? t(message)
          : t("failed")}
    </p>
  );
}

/** Enrollment evidence never inherits an owner's current grade or confirmation requirement. */
export function EnrollmentGrade({
  grade,
  graduated,
}: {
  grade?: string | null;
  graduated?: boolean;
}) {
  const t = useTranslations("tuteeHistory");
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">
        {graduated
          ? t("graduatedRecorded")
          : grade
            ? t("recordedGrade", { grade })
            : t("notRecorded")}
      </p>
      <p className="muted text-xs">{t("enrollmentEvidence")}</p>
    </div>
  );
}

export function TuteeHistoryDialog({
  tuteeId,
  onClose,
  personal = false,
}: {
  tuteeId: string;
  onClose: () => void;
  personal?: boolean;
}) {
  const t = useTranslations("tuteeHistory");
  return (
    <ProfileDialog title={t("details")} onClose={onClose} size="wide">
      <TuteeHistoryContent
        key={tuteeId}
        tuteeId={tuteeId}
        personal={personal}
      />
    </ProfileDialog>
  );
}

/** Inline history keeps the same staff/personal authority in either detail surface.
 * Mount only after opening details; reopening refreshes even a recently cached read.
 */
export function TuteeHistoryContent({
  tuteeId,
  personal = false,
}: {
  tuteeId: string;
  personal?: boolean;
}) {
  const t = useTranslations("tuteeHistory");
  const ui = useTranslations("uiPatterns");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const staff = api.tuteeHistory.details.useQuery(
    { tuteeId, page },
    { enabled: !personal, refetchOnMount: "always" },
  );
  const own = api.tuteeHistory.myDetails.useQuery(
    { tuteeId, page },
    { enabled: personal, refetchOnMount: "always" },
  );
  const query = personal ? own : staff;
  const deniedRead = useHistoryReadDenial(own);
  const denied = personal && deniedRead;
  const data = denied ? undefined : query.data;
  return (
    <div className="min-w-0 space-y-4">
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {(denied || query.error) && (
        <div className="space-y-2">
          <HistoryError
            message={denied ? "historyAccessLost" : query.error!.message}
          />
          <Button
            size="compact"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {ui("retry")}
          </Button>
        </div>
      )}
      {/* A failed background read must not erase already loaded history. */}
      {data && (
        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-semibold">{data.record.name}</h3>
            <p className="muted text-xs break-all">
              {t("recordId", { id: data.record.id })}
            </p>
            <p className="muted text-sm">
              {data.term?.name ?? t("periodUnknown")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-2 font-semibold">{t("originalAcademics")}</h4>
              <EnrollmentGrade
                grade={data.record.gradeLevel}
                graduated={data.record.academicallyGraduated}
              />
            </section>
            <section className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-2 font-semibold">{t("currentAcademics")}</h4>
              {data.owner ? (
                <>
                  <p className="mb-2 text-sm">
                    {data.owner.username
                      ? `@${data.owner.username}`
                      : (data.owner.name ?? t("linkedAccount"))}
                  </p>
                  {/* Missing current academics are expected for alumni; viewing
                      personal evidence must not imply a new enrollment requirement. */}
                  {personal &&
                  data.owner.academic.status === "UNKNOWN" &&
                  !data.owner.academic.rawGrade ? (
                    <p className="muted text-sm">
                      {t("currentAcademicsOptional")}
                    </p>
                  ) : (
                    <AcademicDetails academic={data.owner.academic} />
                  )}
                </>
              ) : (
                <p className="muted text-sm">{t("noAccountHelp")}</p>
              )}
            </section>
          </div>
          {data.historicalAcademics && (
            <HistoricalAcademicEvidence records={data.historicalAcademics} />
          )}
          <p className="muted text-sm">
            {t("sessionCount", { count: data.count })}
          </p>
          <ScrollTable label={t("details")} hint={t("scrollHint")}>
            <table className="data-table min-w-[38rem]">
              <thead>
                <tr>
                  <th>{t("date")}</th>
                  <th>{t("period")}</th>
                  <th>{t("subject")}</th>
                  <th>{t("tutor")}</th>
                  <th>{t("attendance")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((row) => (
                  <tr key={row.session.id}>
                    <td>
                      {format.dateTime(row.session.date, {
                        dateStyle: "medium",
                        // Preserve the original attendance day in every program timezone.
                        timeZone: "UTC",
                      })}
                    </td>
                    <td>
                      {row.session.schoolYear} · {row.session.quarter}
                    </td>
                    <td>{row.session.pairing.subject}</td>
                    <td>{row.session.tutor.englishName}</td>
                    <td>{t(`attendance_${row.status}`)}</td>
                  </tr>
                ))}
                {!data.sessions.length && (
                  <tr>
                    <td colSpan={5}>{t("noSessions")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollTable>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className="btn-secondary min-h-11 lg:min-h-9"
              disabled={page === 0 || query.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("previous")}
            </button>
            <span className="muted text-sm">
              {t("page", {
                page: page + 1,
                pages: Math.max(1, Math.ceil(data.count / 50)),
              })}
            </span>
            <button
              className="btn-secondary min-h-11 lg:min-h-9"
              disabled={(page + 1) * 50 >= data.count || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A selected account never follows a changing search, and a changed selection discards
 * the preview. Server fingerprints independently reject a changed record or account. */
export function TuteeHistoryLinkForm({
  row,
  canCorrectOwnership,
  onLinked,
  onPendingChange,
  parentPending = false,
  invitationOnly = false,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
  canCorrectOwnership: boolean;
  onLinked: () => void;
  onPendingChange?: (pending: boolean) => void;
  parentPending?: boolean;
  /** Unified combination owns existing-account association in real editors. */
  invitationOnly?: boolean;
}) {
  const t = useTranslations("tuteeHistory");
  const format = useFormatter();
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview] = useState<
    RouterOutputs["tuteeHistory"]["preview"] | null
  >(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<
    (RouterOutputs["tuteeHistory"]["invite"] & { email: string }) | null
  >(null);
  const [completedEmail, setCompletedEmail] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [permissionLost, setPermissionLost] = useState(false);
  const refreshingRef = useRef(false);
  const [expectedUpdatedAt] = useState(row.updatedAt);
  const submitting = useRef(false);
  const reviewPending = useRef(false);
  const [linked, setLinked] = useState(false);
  const linkCommitted = useRef(false);
  const [linkAccepted, setLinkAccepted] = useState(false);
  const linkRefreshInFlight = useRef(false);
  const [linkSyncing, setLinkSyncing] = useState(false);
  const [linkRefreshFailed, setLinkRefreshFailed] = useState(false);
  const settled = () => {
    submitting.current = false;
  };
  const [cancelled, setCancelled] = useState(false);
  const invitation = api.tuteeHistory.invitationStatus.useQuery(
    { tuteeId: row.id },
    { refetchOnMount: "always" },
  );
  const accessDenied = permissionLost || historyAccessDenied(invitation.error);
  const status = accessDenied ? null : invitation.data;
  // Retain the mutation receipt while its synchronization is unresolved. Once
  // synchronized, a newer query may reveal another manager's pending replacement.
  const attempt = accessDenied
    ? null
    : refreshRequired
      ? (receipt ?? status?.attempt)
      : (status?.attempt ?? receipt);
  const statusReady =
    invitation.data !== undefined &&
    !invitation.error &&
    !invitation.isFetching &&
    !refreshRequired &&
    !refreshing &&
    !accessDenied;
  const uncertain = attempt?.status === "UNCERTAIN";
  const canCancel = !!status && (!!status.invitation || uncertain);
  // Suppress a repeated send only while our accepted recipient still has a live
  // grant. A past published receipt alone is not current invitation authority.
  const alreadyPublished =
    completedEmail !== null &&
    completedEmail === email.trim().toLowerCase() &&
    status?.invitation?.email.trim().toLowerCase() === completedEmail;
  // A resolved write is never replayed to recover a failed read. This read owns no
  // dialog busy registration, so settled writes leave the editor dismissible.
  const refreshInvitation = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const result = await invitation.refetch({ throwOnError: true });
      if (result.error)
        // Refetch may resolve with a non-Error tRPC shape. Preserve its authority
        // code when normalizing so a denied read still conceals private evidence.
        throw Object.assign(new Error(result.error.message), {
          data: result.error.data,
        });
      setReceipt(result.data?.attempt ?? null);
      setRefreshRequired(false);
      setRefreshError(false);
      setPermissionLost(false);
      setError(null);
    } catch (cause) {
      setRefreshRequired(true);
      setRefreshError(true);
      if (historyAccessDenied(cause)) setPermissionLost(true);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };
  const cancelInvitation = api.tuteeHistory.cancelInvitation.useMutation({
    onSettled: settled,
    onSuccess: async (result) => {
      setReceipt(null);
      setCompletedEmail(null);
      setCancelled(result.cancelled);
      setRefreshRequired(true);
      await refreshInvitation();
    },
    onError: (e) => {
      setError(e.message);
      // A stale revision requires a deliberate read before any further cancellation.
      setRefreshRequired(true);
      if (historyAccessDenied(e)) setPermissionLost(true);
    },
  });
  const candidates = api.tuteeHistory.candidates.useQuery(
    { search: query },
    { enabled: query.length >= 2 && !accessDenied },
  );
  const privateDenied = accessDenied || historyAccessDenied(candidates.error);
  useEffect(() => {
    if (historyAccessDenied(candidates.error)) setPermissionLost(true);
  }, [candidates.error]);
  // Accepted ownership is never submitted again to recover a failed read.
  // Keep the receipt until every affected read settles; independent drafts survive.
  const refreshLink = async () => {
    if (linkRefreshInFlight.current) return;
    linkRefreshInFlight.current = true;
    setLinkSyncing(true);
    try {
      await settleRefreshes([
        async () => {
          await invalidateTuteeViews(utils, { reportErrors: true });
        },
        () => invalidateAndReport(utils.admin.accountDetails),
        () => invalidateAndReport(utils.student),
      ]);
      setLinkRefreshFailed(false);
      setLinked(true);
    } catch {
      setLinkRefreshFailed(true);
    } finally {
      linkRefreshInFlight.current = false;
      setLinkSyncing(false);
    }
  };
  const link = api.tuteeHistory.link.useMutation({
    onSettled: settled,
    onSuccess: async () => {
      linkCommitted.current = true;
      setLinkAccepted(true);
      setPreview(null);
      setAcknowledged(false);
      setPassword("");
      await refreshLink();
    },
    onError: (e) => {
      setError(e.message);
      if (historyAccessDenied(e)) setPermissionLost(true);
      setPreview(null);
      setPassword("");
    },
  });
  const invite = api.tuteeHistory.invite.useMutation({
    onSettled: settled,
    onSuccess: async (result, input) => {
      setReceipt({ ...result, email: input.email });
      setCompletedEmail(
        result.status === "PUBLISHED" ? input.email.trim().toLowerCase() : null,
      );
      setCancelled(false);
      setRefreshRequired(true);
      await refreshInvitation();
    },
    onError: (e, input) => {
      setError(e.message);
      // A lost response may hide an admitted attempt. Read or cancel it before
      // sending again; editing the address must never bypass this uncertainty.
      const rejectedBeforeDelivery = [
        "BAD_REQUEST",
        "CONFLICT",
        "PRECONDITION_FAILED",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "TOO_MANY_REQUESTS",
      ].includes(e.data?.code ?? "");
      setReceipt(
        rejectedBeforeDelivery
          ? null
          : {
              attemptId: "",
              status: "UNCERTAIN",
              expiresAt: null,
              email: input.email,
            },
      );
      setRefreshRequired(true);
      if (historyAccessDenied(e)) setPermissionLost(true);
    },
  });
  // Preview is a dismissible read. Register actual link/invitation/cancellation writes only.
  const ownPending =
    link.isPending || invite.isPending || cancelInvitation.isPending;
  const busy = useDialogPending(ownPending);
  const pending =
    busy ||
    parentPending ||
    reviewing ||
    linked ||
    privateDenied ||
    linkAccepted;
  // Report owned work only; inherited aggregate registration would latch sibling forms.
  useLayoutEffect(() => {
    onPendingChange?.(ownPending);
    return () => onPendingChange?.(false);
  }, [ownPending, onPendingChange]);
  useEffect(() => {
    if (!linked || busy || parentPending || linkSyncing) return;
    setLinked(false);
    onLinked();
  }, [linked, busy, parentPending, linkSyncing, onLinked]);
  return (
    <fieldset
      disabled={busy || parentPending || reviewing || linked}
      aria-busy={ownPending}
      className="min-w-0 space-y-5"
    >
      <legend className="sr-only">{t("linkTitle")}</legend>
      {linkAccepted && (
        <InlineNotice tone="success" announcement="status">
          {t("linkSaved")}
        </InlineNotice>
      )}
      {linkRefreshFailed && (
        <InlineNotice
          tone="warning"
          announcement="alert"
          action={
            <Button
              disabled={busy || parentPending || linkSyncing}
              onClick={() => void refreshLink()}
            >
              {t("refreshLinkedHistory")}
            </Button>
          }
        >
          {t("linkRefreshFailed")}
        </InlineNotice>
      )}
      {linkSyncing && <p role="status">{t("loading")}</p>}
      <div>
        <p className="font-semibold">{row.englishName}</p>
        <p className="muted text-xs break-all">
          {t("recordId", { id: row.id })}
        </p>
        <p className="muted mt-1 text-sm">{t("linkHelp")}</p>
      </div>
      <label className="block">
        <span className="label">{t("evidence")}</span>
        <textarea
          className="input w-full"
          disabled={pending}
          rows={3}
          value={reason}
          minLength={10}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {!invitationOnly && (
        <section className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold">{t("existingAccount")}</h3>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                pending ||
                submitting.current ||
                reviewPending.current ||
                search.trim().length < 2
              )
                return;
              setQuery(search.trim());
              setUserId("");
              setPreview(null);
              setAcknowledged(false);
              setError(null);
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="label">{t("searchAccount")}</span>
              <input
                className="input w-full"
                disabled={pending}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </label>
            <button
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={search.trim().length < 2 || pending}
            >
              {t("search")}
            </button>
          </form>
          {candidates.isFetching && <p role="status">{t("loading")}</p>}
          {candidates.error && (
            <HistoryError message={candidates.error.message} />
          )}
          {!privateDenied && candidates.data && (
            <label className="block">
              <span className="label">{t("chooseAccount")}</span>
              <select
                className="select w-full"
                disabled={pending}
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setPreview(null);
                  setAcknowledged(false);
                  setError(null);
                }}
              >
                <option value="">{t("chooseAccount")}</option>
                {candidates.data.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name ?? account.username ?? account.email} ·{" "}
                    {account.email}
                  </option>
                ))}
              </select>
              {!candidates.data.length && (
                <p className="muted text-sm">{t("noAccounts")}</p>
              )}
            </label>
          )}
          <button
            className="btn-secondary min-h-11 lg:min-h-9"
            disabled={!userId || pending}
            onClick={async () => {
              if (
                pending ||
                submitting.current ||
                reviewPending.current ||
                !userId
              )
                return;
              reviewPending.current = true;
              setReviewing(true);
              setError(null);
              setAcknowledged(false);
              try {
                setPreview(
                  await utils.tuteeHistory.preview.fetch(
                    { tuteeId: row.id, userId },
                    { staleTime: 0 },
                  ),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "HISTORY_STALE");
                if (historyAccessDenied(e)) setPermissionLost(true);
              } finally {
                reviewPending.current = false;
                setReviewing(false);
              }
            }}
          >
            {t("preview")}
          </button>
          {!privateDenied && preview && (
            <div className="space-y-3 rounded-lg bg-slate-50 p-3">
              <p className="text-sm">
                {t("previewSummary", {
                  name: preview.record.name,
                  count: preview.record.sessions,
                  account: preview.account.name ?? preview.account.email,
                })}
              </p>
              {preview.currentConflict ? (
                <HistoryError message="HISTORY_USE_MERGE" />
              ) : preview.conflict && !canCorrectOwnership ? (
                <HistoryError message="HISTORY_HEAD_REQUIRED" />
              ) : (
                <>
                  {preview.conflict && (
                    <>
                      <p className="text-sm text-amber-800">
                        {t("headCorrection")}
                      </p>
                      <label className="block">
                        <span className="label">{t("password")}</span>
                        <input
                          className="input w-full"
                          type="password"
                          disabled={pending}
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={pending}
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    {t("confirmIdentity")}
                  </label>
                  <button
                    className="btn-primary min-h-11 lg:min-h-10"
                    disabled={
                      pending ||
                      !acknowledged ||
                      reason.trim().length < 10 ||
                      (preview.conflict && !password)
                    }
                    onClick={() => {
                      if (
                        pending ||
                        submitting.current ||
                        linkCommitted.current ||
                        reviewPending.current ||
                        !acknowledged ||
                        reason.trim().length < 10 ||
                        !userId ||
                        preview.currentConflict ||
                        (preview.conflict && (!canCorrectOwnership || !password))
                      )
                        return;
                      submitting.current = true;
                      setError(null);
                      link.mutate({
                        tuteeId: row.id,
                        userId,
                        fingerprint: preview.fingerprint,
                        reason,
                        acknowledged: true,
                        ...(preview.conflict
                          ? { confirmPassword: password }
                          : {}),
                      });
                    }}
                  >
                    {t("link")}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {!row.owner && !row.user && (
        <section className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold">{t("invitation")}</h3>
          <p className="muted text-sm">{t("inviteHelp")}</p>
          <QueryFeedback
            hasData={!accessDenied && invitation.data !== undefined}
            loading={invitation.isLoading || invitation.data === undefined}
            error={!!invitation.error || refreshError || accessDenied}
            retrying={
              refreshing ||
              invitation.isFetching ||
              busy ||
              parentPending ||
              reviewing ||
              linked
            }
            loadingTitle={t("loading")}
            errorTitle={
              accessDenied
                ? t("invitationDenied")
                : t("invitationRefreshFailed")
            }
            retryLabel={t("refreshInvitation")}
            onRetry={() => void refreshInvitation()}
          />
          {refreshRequired &&
            !refreshError &&
            !invitation.error &&
            !accessDenied && (
              <InlineNotice tone="warning" announcement="status">
                <p>{t("invitationRefreshRequired")}</p>
                <Button
                  size="compact"
                  disabled={pending || refreshing}
                  onClick={() => void refreshInvitation()}
                >
                  {t("refreshInvitation")}
                </Button>
              </InlineNotice>
            )}
          {!accessDenied && cancelled && (
            <p role="status" className="text-sm">
              {t("invitationCancelled")}
            </p>
          )}
          {status?.invitation && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="break-all">
                {t("invitationRecipient", { email: status.invitation.email })}
              </p>
              <p>
                {t("invitationExpiry", {
                  date: format.dateTime(status.invitation.expiresAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
            </div>
          )}
          {attempt && (
            <InlineNotice
              tone={
                attempt.status === "PUBLISHED"
                  ? "success"
                  : attempt.status === "DELIVERY_FAILED"
                    ? "error"
                    : "warning"
              }
              announcement="status"
            >
              <p className="font-medium">{t(`invitation_${attempt.status}`)}</p>
              <p className="mt-1 break-all">
                {t("invitationAttemptRecipient", { email: attempt.email })}
              </p>
            </InlineNotice>
          )}
          {canCancel && !accessDenied && (
            <div className="space-y-2">
              <p className="muted text-sm">{t("cancelInvitationHelp")}</p>
              <Button
                disabled={pending || !statusReady}
                onClick={() => {
                  if (
                    pending ||
                    !statusReady ||
                    submitting.current ||
                    reviewPending.current ||
                    !status
                  )
                    return;
                  submitting.current = true;
                  setError(null);
                  cancelInvitation.mutate({
                    tuteeId: row.id,
                    revision: status.revision,
                  });
                }}
              >
                {t("cancelInvitation")}
              </Button>
            </div>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                pending ||
                submitting.current ||
                reviewPending.current ||
                reason.trim().length < 10 ||
                !email ||
                !statusReady ||
                uncertain ||
                alreadyPublished ||
                row.owner ||
                row.user
              )
                return;
              submitting.current = true;
              setError(null);
              invite.mutate({
                tuteeId: row.id,
                email,
                expectedUpdatedAt,
                reason,
              });
            }}
          >
            <label className="block">
              <span className="label">{t("email")}</span>
              <input
                className="input w-full"
                type="email"
                disabled={pending}
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </label>
            <button
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={
                pending ||
                !statusReady ||
                uncertain ||
                reason.trim().length < 10 ||
                !email ||
                alreadyPublished
              }
            >
              {t("sendInvitation")}
            </button>
          </form>
        </section>
      )}
      {error && <HistoryError message={error} />}
    </fieldset>
  );
}
