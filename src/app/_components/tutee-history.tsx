"use client";
import { invalidateTuteeViews } from "~/lib/tutee-cache";

import { useLayoutEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
import { AcademicDetails } from "./academic-profile";

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
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const staff = api.tuteeHistory.details.useQuery(
    { tuteeId, page },
    { enabled: !personal },
  );
  const own = api.tuteeHistory.myDetails.useQuery(
    { tuteeId, page },
    { enabled: personal },
  );
  const query = personal ? own : staff;
  const data = query.data;
  return (
    <ProfileDialog title={t("details")} onClose={onClose} size="wide">
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {query.error && <HistoryError message={query.error.message} />}
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
          <p className="muted text-sm">
            {t("sessionCount", { count: data.count })}
          </p>
          <p className="muted text-xs sm:hidden">{t("scrollHint")}</p>
          <div className="overflow-x-auto">
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
          </div>
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
    </ProfileDialog>
  );
}

/** A selected account never follows a changing search, and a changed selection discards
 * the preview. Server fingerprints independently reject a changed record or account. */
export function TuteeHistoryLinkForm({
  row,
  isHead,
  onLinked,
  onPendingChange,
  parentPending = false,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
  isHead: boolean;
  onLinked: () => void;
  onPendingChange?: (pending: boolean) => void;
  parentPending?: boolean;
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
  const [sent, setSent] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const invitation = api.tuteeHistory.invitationStatus.useQuery({
    tuteeId: row.id,
  });
  const cancelInvitation = api.tuteeHistory.cancelInvitation.useMutation({
    onSuccess: async () => {
      setSent(false);
      setCancelled(true);
      await invitation.refetch();
    },
    onError: (e) => setError(e.message),
  });
  const candidates = api.tuteeHistory.candidates.useQuery(
    { search: query },
    { enabled: query.length >= 2 },
  );
  const link = api.tuteeHistory.link.useMutation({
    onSuccess: async () => {
      await Promise.all([
        invalidateTuteeViews(utils),
        utils.student.invalidate(),
      ]);
      // The editor remains open; a second attempt must obtain a fresh ownership preview.
      setPreview(null);
      setAcknowledged(false);
      setPassword("");
      onLinked();
    },
    onError: (e) => {
      setError(e.message);
      setPreview(null);
      setPassword("");
    },
  });
  const invite = api.tuteeHistory.invite.useMutation({
    onSuccess: async () => {
      setSent(true);
      setCancelled(false);
      await invitation.refetch();
    },
    onError: (e) => setError(e.message),
  });
  const ownPending =
    link.isPending ||
    invite.isPending ||
    cancelInvitation.isPending ||
    reviewing;
  const pending = ownPending || parentPending;
  // Report only owned work. Feeding the inherited busy state back to the parent
  // would latch both forms disabled after either request finished. Layout timing
  // disables sibling actions before another painted interaction can submit them.
  useLayoutEffect(() => {
    onPendingChange?.(ownPending);
    return () => onPendingChange?.(false);
  }, [ownPending, onPendingChange]);
  return (
    <fieldset
      disabled={pending}
      aria-busy={pending}
      className="min-w-0 space-y-5"
    >
      <legend className="sr-only">{t("linkTitle")}</legend>
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
          rows={3}
          value={reason}
          minLength={10}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold">{t("existingAccount")}</h3>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
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
        {candidates.data && (
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
            if (pending) return;
            setReviewing(true);
            setError(null);
            setAcknowledged(false);
            try {
              setPreview(
                await utils.tuteeHistory.preview.fetch({
                  tuteeId: row.id,
                  userId,
                }),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "HISTORY_STALE");
            } finally {
              setReviewing(false);
            }
          }}
        >
          {t("preview")}
        </button>
        {preview && (
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
            ) : preview.conflict && !isHead ? (
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
                    if (pending) return;
                    link.mutate({
                      tuteeId: row.id,
                      userId,
                      fingerprint: preview.fingerprint,
                      reason,
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
      {!row.owner && !row.user && (
        <section className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold">{t("invitation")}</h3>
          <p className="muted text-sm">{t("inviteHelp")}</p>
          {invitation.error && (
            <HistoryError message={invitation.error.message} />
          )}
          {cancelled && (
            <p role="status" className="text-sm">
              {t("invitationCancelled")}
            </p>
          )}
          {invitation.data && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="break-all">
                {t("invitationRecipient", { email: invitation.data.email })}
              </p>
              <p>
                {t("invitationExpiry", {
                  date: format.dateTime(invitation.data.expiresAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
              <button
                type="button"
                className="btn-secondary min-h-11 lg:min-h-10"
                disabled={pending}
                onClick={() => {
                  if (pending) return;
                  setError(null);
                  cancelInvitation.mutate({
                    tuteeId: row.id,
                    revision: invitation.data!.revision,
                  });
                }}
              >
                {t("cancelInvitation")}
              </button>
            </div>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) return;
              setError(null);
              invite.mutate({
                tuteeId: row.id,
                email,
                expectedUpdatedAt: row.updatedAt,
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
                  setSent(false);
                }}
              />
            </label>
            <button
              className="btn-secondary min-h-11 lg:min-h-10"
              disabled={pending || reason.trim().length < 10 || !email || sent}
            >
              {t("sendInvitation")}
            </button>
          </form>
          {sent && (
            <p role="status" className="text-sm text-green-800">
              {t("sent")}
            </p>
          )}
        </section>
      )}
      {error && <HistoryError message={error} />}
    </fieldset>
  );
}
