"use client";

import { accountMembership, membershipBadges } from "~/lib/account-membership";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmailDetails } from "~/app/_components/email-details";
import { AccountProfileEditor } from "~/app/_components/account-profile-editor";
import { MultiFilter } from "~/app/_components/multi-filter";
import {
  emptyUserFilters,
  isTutorStatusApplicable,
  matchesUserFilters,
  normalizeUserFilters,
  parseUserFilters,
  type UserFilters,
} from "~/lib/user-filters";
import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useDialog } from "~/app/_components/confirm-dialog";

const ALL_ROLES = [
  "STUDENT",
  "VIEWER",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
  "CREW",
  "TRANSLATOR",
] as const;
const TUTOR_STATUSES = [
  "ACTIVE",
  "PENDING",
  "GRADUATED",
  "OPTED_OUT",
  "ARCHIVED",
] as const;
const ACCOUNT_STATES = ["registered", "setup", "invited", "none"] as const;

/**
 * Step-up identity check for dangerous actions (role change, leadership transfer, account
 * deletion). The admin re-enters their own password; the value is passed to the action's
 * `run` callback (which calls the mutation with `confirmPassword`). Mounted fresh per action,
 * so the password field always starts empty.
 */
function ConfirmIdentityDialog({
  title,
  body,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const t = useTranslations();
  const [password, setPassword] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        className="card w-full max-w-sm space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) onConfirm(password);
        }}
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="muted text-sm">{body}</p>
        </div>
        <div>
          <label className="label">
            {t("admin.users.confirm.passwordLabel")}
          </label>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("admin.users.confirm.passwordPlaceholder")}
            className="input w-full"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={onCancel}
            disabled={pending}
          >
            {t("admin.users.confirm.cancel")}
          </button>
          <button
            type="submit"
            className="btn-primary btn-sm"
            disabled={pending || !password}
          >
            {pending ? t("admin.users.confirm.working") : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function UsersPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const accounts = api.admin.accounts.useQuery();
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const editingProfile = accounts.data?.rows.find(
    (row) => row.userId === editingProfileId,
  );
  const invalidate = () => utils.admin.accounts.invalidate();

  // Designed confirm/prompt dialog (replaces native window.prompt for the suspension reason).
  const { promptText, dialog } = useDialog();

  // Dangerous actions run behind an identity-confirmation dialog (see ConfirmIdentityDialog).
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    run: (password: string) => void;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const closeConfirm = () => {
    setConfirm(null);
    setConfirmError(null);
  };
  const guardedMutation = {
    onSuccess: () => {
      void invalidate();
      closeConfirm();
    },
    onError: (e: { message: string }) => setConfirmError(e.message),
  };

  const deleteUser = api.admin.deleteUser.useMutation(guardedMutation);
  const appeals = api.admin.appeals.useQuery();
  const refreshUsers = () =>
    Promise.all([invalidate(), utils.admin.appeals.invalidate()]);
  const suspendUser = api.admin.suspendUser.useMutation({
    onSuccess: refreshUsers,
  });
  const reinstateUser = api.admin.reinstateUser.useMutation({
    onSuccess: refreshUsers,
  });
  const decideAppeal = api.admin.decideAppeal.useMutation({
    onSuccess: refreshUsers,
  });
  const sendSetup = api.admin.sendTutorSetup.useMutation({
    onSuccess: (data, variables) =>
      setSetupInfo({
        tutorId: variables.tutorId,
        link: data.link,
        emailed: data.emailed,
      }),
  });
  const [setupInfo, setSetupInfo] = useState<{
    tutorId: string;
    link: string;
    emailed: boolean;
  } | null>(null);

  const callerRole = accounts.data?.caller.role;
  const isHead = callerRole === "HEAD";
  const isAdminTier = isHead || callerRole === "ADMIN";
  const confirmPending = deleteUser.isPending;
  const sort = useSort("name");

  // Persist by account only after loading that account's preference; never overwrite on hydration.
  const [filterState, setFilterState] = useState<{
    userId: string;
    filters: UserFilters;
  } | null>(null);
  const viewerId = accounts.data?.caller.id;
  useEffect(() => {
    if (!viewerId) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(`shbs:user-filters:${viewerId}:v1`);
    } catch {
      /* Private browsing may disable storage. */
    }
    const restored = parseUserFilters(raw);
    setFilterState({ userId: viewerId, filters: restored });
    // Repair this account's saved preference after reading it, including stale hidden status.
    try {
      if (raw !== null) localStorage.setItem(`shbs:user-filters:${viewerId}:v1`, JSON.stringify(restored));
    } catch {
      /* Storage restrictions must not prevent the normalized in-memory result. */
    }
  }, [viewerId]);
  const filters = useMemo(
    () =>
      filterState?.userId === viewerId
        ? (filterState?.filters ?? emptyUserFilters())
        : emptyUserFilters(),
    [filterState, viewerId],
  );
  const updateFilters = (next: UserFilters) => {
    if (!viewerId) return;
    const normalized = normalizeUserFilters(next);
    setFilterState({ userId: viewerId, filters: normalized });
    try {
      localStorage.setItem(
        `shbs:user-filters:${viewerId}:v1`,
        JSON.stringify(normalized),
      );
    } catch {
      /* Keep in-memory filtering usable. */
    }
  };
  const rows = useMemo(() => {
    const data = accounts.data?.rows ?? [];
    const filtered = data.filter((u) => matchesUserFilters(u, filters));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "tutor":
          return (
            compare(a.tutor?.englishName ?? "", b.tutor?.englishName ?? "") *
            dir
          );
        case "account":
          return compare(a.account, b.account) * dir;
        case "role":
          return compare(a.role ?? "", b.role ?? "") * dir;
        case "name":
        default:
          return compare(a.name, b.name) * dir;
      }
    });
  }, [accounts.data, sort.key, sort.dir, filters]);

  const accountBadge = (status: string) =>
    status === "registered"
      ? "badge-green"
      : status === "none"
        ? "badge-slate"
        : "badge-amber";

  return (
    <div className="space-y-6">
      {editingProfile?.userId && editingProfile.profileVersion !== null && (
        <AccountProfileEditor
          profile={{
            userId: editingProfile.userId,
            name: editingProfile.name,
            alternativeNames: editingProfile.alternativeNames,
            profileVersion: editingProfile.profileVersion,
          }}
          membership={accountMembership(editingProfile)}
          isHead={isHead}
          onClose={() => setEditingProfileId(null)}
        />
      )}
      <div>
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <p className="muted mt-1">
          {isAdminTier
            ? t("admin.users.subtitle")
            : t("admin.users.coordinatorHint")}
        </p>
      </div>

      <section className="card space-y-3 p-4">
        <p className="muted text-sm">{t("userMultiFilters.hint")}</p>
        <div className={`grid items-start gap-3 ${isTutorStatusApplicable(filters.role) ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <MultiFilter
            label={t("admin.users.filters.role")}
            options={[
              ...ALL_ROLES.map((value) => ({
                value,
                label: value === "TRANSLATOR" ? t("membership.translator") : t(`admin.users.roles.${value}`),
              })),
              { value: "__none__", label: t("userMultiFilters.noRole") },
            ]}
            value={filters.role}
            onChange={(role) => updateFilters({ ...filters, role })}
          />
          {isTutorStatusApplicable(filters.role) && <MultiFilter
            label={t("admin.users.filters.status")}
            options={[
              ...TUTOR_STATUSES.map((value) => ({
                value,
                label: t(`admin.tutorStatus.${value}`),
              })),
              { value: "__none__", label: t("userMultiFilters.noTutor") },
            ]}
            value={filters.status}
            onChange={(status) => updateFilters({ ...filters, status })}
          />}
          <MultiFilter
            label={t("admin.users.filters.account")}
            options={ACCOUNT_STATES.map((value) => ({
              value,
              label: t(`admin.tutors.account.${value}`),
            }))}
            value={filters.account}
            onChange={(account) => updateFilters({ ...filters, account })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="muted text-sm">
            {t("userMultiFilters.count", {
              count: rows.length,
              total: accounts.data?.rows.length ?? 0,
            })}
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm min-h-11 lg:min-h-8"
            onClick={() => updateFilters(emptyUserFilters())}
          >
            {t("userMultiFilters.clear")}
          </button>
        </div>
      </section>

      {setupInfo && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-slate-700">
              {setupInfo.emailed
                ? t("admin.tutors.account.linkEmailed")
                : t("admin.tutors.account.linkManual")}
            </p>
            <button className="link text-xs" onClick={() => setSetupInfo(null)}>
              {t("admin.tutors.account.dismiss")}
            </button>
          </div>
          <input
            readOnly
            value={setupInfo.link}
            onFocus={(e) => e.target.select()}
            className="input mt-2 w-full font-mono text-xs"
          />
        </div>
      )}

      {/* Pending reinstatement appeals from suspended viewers. */}
      {(appeals.data ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 py-3">
            <h2 className="section-title">
              {t("admin.users.appeals.heading")}
            </h2>
          </div>
          <div className="divide-y divide-slate-100 px-5 pb-3">
            {(appeals.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <span className="font-medium text-slate-800">{a.name}</span>
                {a.affiliation && (
                  <span className="muted text-xs">{a.affiliation}</span>
                )}
                <span className="muted min-w-0 flex-1 truncate text-xs italic">
                  “{a.message}”
                </span>
                <span className="flex gap-2">
                  <button
                    className="btn-primary btn-sm"
                    disabled={decideAppeal.isPending}
                    onClick={() =>
                      decideAppeal.mutate({ appealId: a.id, action: "APPROVE" })
                    }
                  >
                    {t("admin.users.appeals.approve")}
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={decideAppeal.isPending}
                    onClick={() =>
                      decideAppeal.mutate({ appealId: a.id, action: "DENY" })
                    }
                  >
                    {t("admin.users.appeals.deny")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="name">
                {t("admin.users.columns.user")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="tutor">
                {t("admin.users.columns.linkedTutor")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="account">
                {t("admin.users.columns.account")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="role">
                {t("admin.users.columns.role")}
              </SortHeader>
              <th>{t("admin.users.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const key = u.userId ?? `tutor-${u.tutorId}`;
              return (
                <tr key={key}>
                  {/* Identity contains names and the handle; all row actions live in the last column. */}
                  <td>
                    <div className="leading-tight">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      {(u.username ?? u.tutor?.username) && (
                        <p className="muted text-xs">
                          @{u.username ?? u.tutor?.username}
                        </p>
                      )}
                      {u.alternativeNames && (
                        <p className="muted text-xs">{u.alternativeNames}</p>
                      )}
                    </div>
                  </td>

                  {/* Linked tutor: name, class-of year + grade, lifecycle status. */}
                  <td className="text-slate-600">
                    {u.tutor ? (
                      <div className="leading-tight">
                        <p>{u.tutor.englishName}</p>
                        <p className="muted text-xs">
                          {u.classOf != null
                            ? `${t("admin.tutors.classOf", { year: u.classOf })} · `
                            : u.tutor.gradeLevel != null
                              ? `G${u.tutor.gradeLevel} · `
                              : ""}
                          {u.tutorStatus
                            ? t(`admin.tutorStatus.${u.tutorStatus}`)
                            : ""}
                        </p>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Account: setup/login status + invite/resend (only for linked tutors). */}
                  <td>
                    {u.tutorId ? (
                      <div className="space-y-1 leading-tight">
                        <div>
                          <span className={accountBadge(u.account)}>
                            {t(`admin.tutors.account.${u.account}`)}
                          </span>
                        </div>
                        {/* Provision a login only for tutors who don't have a finished one yet.
                            A registered user self-serves via /forgot-password — no admin resend. */}
                        {(u.account === "none" || u.account === "setup") && (
                          <div>
                            <button
                              className="link text-xs whitespace-nowrap"
                              disabled={!u.tutorHasEmail || sendSetup.isPending}
                              title={
                                !u.tutorHasEmail
                                  ? t("admin.tutors.account.needEmail")
                                  : undefined
                              }
                              onClick={() =>
                                u.tutorId &&
                                sendSetup.mutate({ tutorId: u.tutorId })
                              }
                            >
                              {t("admin.tutors.account.sendSetup")}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : u.role === "VIEWER" && u.userId ? (
                      // Viewer (self-registered read-only) account: affiliation + suspend control.
                      <div className="space-y-1 leading-tight">
                        {u.affiliation && (
                          <p className="muted text-xs">{u.affiliation}</p>
                        )}
                        {u.suspended && (
                          <span className="badge-red">
                            {t("admin.users.suspended")}
                          </span>
                        )}
                        {!u.isSelf &&
                          (u.suspended ? (
                            <div>
                              <button
                                className="link text-xs"
                                disabled={reinstateUser.isPending}
                                onClick={() =>
                                  reinstateUser.mutate({ userId: u.userId })
                                }
                              >
                                {t("admin.users.reinstate")}
                              </button>
                            </div>
                          ) : (
                            <div>
                              <button
                                className="link text-xs text-red-600"
                                disabled={suspendUser.isPending}
                                onClick={async () => {
                                  const reason = await promptText({
                                    title: t("admin.users.suspendTitle"),
                                    reasonLabel: t("admin.users.suspendPrompt"),
                                    confirmLabel: t("admin.users.suspend"),
                                    cancelLabel: t("common.cancel"),
                                    danger: true,
                                  });
                                  if (reason === null) return; // cancelled
                                  const userId = u.userId;
                                  if (!userId) return;
                                  suspendUser.mutate({
                                    userId,
                                    reason:
                                      reason.length > 0 ? reason : undefined,
                                  });
                                }}
                              >
                                {t("admin.users.suspend")}
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Readable, composable badges; assignments live inside Edit Profile. */}
                  <td><div className="flex flex-wrap gap-1.5">
                    {membershipBadges(accountMembership(u)).map(badge => (
                      <span key={badge} className={badge === "HEAD" ? "badge-green" : "badge-slate"}>
                        {badge === "TRANSLATOR" ? t("membership.translator") : t(`admin.users.roles.${badge}`)}
                      </span>
                    ))}
                  </div></td>

                  {/* Contact/profile actions stay available to permitted staff. Only deletion is head-only. */}
                  <td>
                    <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                      <EmailDetails
                        showPolicyHistory
                        email={u.email}
                        name={u.name}
                        verifiedAt={u.emailVerifiedAt}
                        userId={u.userId}
                        tutorId={u.tutorId}
                        linked={!!u.userId}
                        canSendSetup={
                          !!u.userId ||
                          (!!u.tutorId && u.email === u.tutor?.email)
                        }
                      />
                      {u.userId && (
                        <button
                          className="link mt-1 block text-xs"
                          onClick={() => setEditingProfileId(u.userId)}
                        >
                          {t("accountProfile.editProfile")}
                        </button>
                      )}
                      {isHead && u.userId && !u.isSelf && u.role !== "HEAD" ? (
                        <button
                          className="link-danger text-xs whitespace-nowrap"
                          onClick={() => {
                            const userId = u.userId;
                            if (!userId) return;
                            setConfirmError(null);
                            setConfirm({
                              title: t("admin.users.confirm.deleteTitle"),
                              body: t("admin.users.confirm.deleteBody", {
                                name: u.name,
                              }),
                              confirmLabel: t("admin.users.delete"),
                              run: (pwd) =>
                                deleteUser.mutate({
                                  userId,
                                  confirmPassword: pwd,
                                }),
                            });
                          }}
                        >
                          {t("admin.users.delete")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Errors from the dangerous (dialog-gated) actions surface inside the dialog itself. */}
      {sendSetup.error && (
        <p className="text-sm text-red-600">
          {
            sendSetup.error
              ?.message
          }
        </p>
      )}

      {confirm && (
        <ConfirmIdentityDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          pending={confirmPending}
          error={confirmError}
          onCancel={closeConfirm}
          onConfirm={(pwd) => {
            setConfirmError(null);
            confirm.run(pwd);
          }}
        />
      )}
      {dialog}
    </div>
  );
}
