"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmailDetails } from "~/app/_components/email-details";
import { AccountProfileEditor } from "~/app/_components/account-profile-editor";
import { MultiFilter } from "~/app/_components/multi-filter";
import {
  emptyUserFilters,
  matchesUserFilters,
  parseUserFilters,
  type UserFilters,
} from "~/lib/user-filters";
import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useDialog } from "~/app/_components/confirm-dialog";

/** Roles an admin/head may assign via the dropdown (HEAD is set only via leadership transfer). */
const ASSIGNABLE_ROLES = [
  "STUDENT",
  "VIEWER",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
] as const;
type RoleValue = (typeof ASSIGNABLE_ROLES)[number];

const ALL_ROLES = [
  "STUDENT",
  "VIEWER",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
] as const;
const TUTOR_STATUSES = [
  "ACTIVE",
  "PENDING",
  "GRADUATED",
  "OPTED_OUT",
  "ARCHIVED",
] as const;
const ACCOUNT_STATES = ["registered", "setup", "invited", "none"] as const;

/** Elevated roles: they live in the admin area and can translate by default (no flag needed). */
const ELEVATED_ROLES: readonly string[] = ["COORDINATOR", "ADMIN", "HEAD"];

/** A small on/off switch used for the can-tutor / can-translate columns. */
function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-accent-600" : "bg-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

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

  const setRole = api.admin.setUserRole.useMutation(guardedMutation);
  const transferHead = api.admin.transferHead.useMutation(guardedMutation);
  const deleteUser = api.admin.deleteUser.useMutation(guardedMutation);
  const setCanTutor = api.admin.setUserCanTutor.useMutation({
    onSuccess: invalidate,
  });
  const setCanTranslate = api.admin.setUserCanTranslate.useMutation({
    onSuccess: invalidate,
  });
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
  const confirmPending =
    setRole.isPending || transferHead.isPending || deleteUser.isPending;
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
    setFilterState({ userId: viewerId, filters: parseUserFilters(raw) });
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
    setFilterState({ userId: viewerId, filters: next });
    try {
      localStorage.setItem(
        `shbs:user-filters:${viewerId}:v1`,
        JSON.stringify(next),
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
        <div className="grid items-start gap-3 md:grid-cols-3">
          <MultiFilter
            label={t("admin.users.filters.role")}
            options={[
              ...ALL_ROLES.map((value) => ({
                value,
                label: t(`admin.users.roles.${value}`),
              })),
              { value: "__none__", label: t("userMultiFilters.noRole") },
            ]}
            value={filters.role}
            onChange={(role) => updateFilters({ ...filters, role })}
          />
          <MultiFilter
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
          />
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
            className="btn-secondary btn-sm"
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
              <th>{t("admin.users.columns.canTutor")}</th>
              <th>{t("admin.users.columns.canTranslate")}</th>
              {isHead && <th>{t("admin.users.columns.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const key = u.userId ?? `tutor-${u.tutorId}`;
              const canTutorApplies =
                !!u.role && ELEVATED_ROLES.includes(u.role);
              const linkedActive = !!u.tutorId && u.tutorStatus === "ACTIVE";
              // Coordinators may only flip their own "can tutor"; the admin tier, anyone's.
              const canEditCanTutor = isAdminTier || u.isSelf;
              // Only the head may change an admin's role or promote to admin.
              const targetIsAdminTier = u.role === "ADMIN" || u.role === "HEAD";
              const canEditRole =
                isAdminTier &&
                !!u.userId &&
                u.role !== "HEAD" &&
                (isHead || !targetIsAdminTier);
              const roleOptions = isHead
                ? ASSIGNABLE_ROLES
                : ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN");
              return (
                <tr key={key}>
                  {/* Identity: name, username, email stacked together. */}
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
                      <EmailDetails
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

                  {/* Role — head manages admins + transfer; admins manage up to coordinator. */}
                  <td>
                    {u.role == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-col items-center gap-1 leading-tight">
                        {u.role === "HEAD" ? (
                          <span className="badge-green">
                            {t("admin.users.roles.HEAD")}
                          </span>
                        ) : canEditRole ? (
                          <select
                            value={u.role}
                            onChange={(e) => {
                              const userId = u.userId;
                              const role = e.target.value as RoleValue;
                              if (!userId) return;
                              setConfirmError(null);
                              setConfirm({
                                title: t("admin.users.confirm.roleTitle"),
                                body: t("admin.users.confirm.roleBody", {
                                  name: u.name,
                                  role: t(`admin.users.roles.${role}`),
                                }),
                                confirmLabel: t(
                                  "admin.users.confirm.roleConfirm",
                                ),
                                run: (pwd) =>
                                  setRole.mutate({
                                    userId,
                                    role,
                                    confirmPassword: pwd,
                                  }),
                              });
                            }}
                            className="select field-auto min-w-36"
                          >
                            {roleOptions.map((r) => (
                              <option key={r} value={r}>
                                {t(`admin.users.roles.${r}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge-slate">
                            {t(`admin.users.roles.${u.role}`)}
                          </span>
                        )}
                        {/* Leadership transfer (head only) to an admin/coordinator. */}
                        {isHead &&
                          !u.isSelf &&
                          u.userId &&
                          (u.role === "ADMIN" || u.role === "COORDINATOR") && (
                            <button
                              className="link text-xs whitespace-nowrap"
                              onClick={() => {
                                const userId = u.userId;
                                if (!userId) return;
                                setConfirmError(null);
                                setConfirm({
                                  title: t("admin.users.confirm.transferTitle"),
                                  body: t("admin.users.confirmTransfer", {
                                    name: u.name,
                                  }),
                                  confirmLabel: t("admin.users.makeHead"),
                                  run: (pwd) =>
                                    transferHead.mutate({
                                      userId,
                                      confirmPassword: pwd,
                                    }),
                                });
                              }}
                            >
                              {t("admin.users.makeHead")}
                            </button>
                          )}
                      </div>
                    )}
                  </td>

                  {/* Can tutor — admin tier for anyone; coordinators only for themselves. */}
                  <td>
                    {canTutorApplies && u.userId ? (
                      <Toggle
                        on={linkedActive}
                        disabled={!canEditCanTutor || setCanTutor.isPending}
                        label={t("admin.users.canTutorLabel")}
                        onClick={() =>
                          u.userId &&
                          setCanTutor.mutate({
                            userId: u.userId,
                            canTutor: !linkedActive,
                          })
                        }
                      />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Can translate — admins/coordinators always can (default); others assignable. */}
                  <td>
                    {u.role == null ? (
                      <span className="text-slate-400">—</span>
                    ) : ELEVATED_ROLES.includes(u.role) ? (
                      <span
                        className="badge-slate"
                        title={t("admin.users.translateDefaultHint")}
                      >
                        {t("admin.users.translateDefault")}
                      </span>
                    ) : (
                      <Toggle
                        on={u.canTranslate}
                        disabled={!isAdminTier || setCanTranslate.isPending}
                        label={t("admin.users.canTranslateLabel")}
                        onClick={() =>
                          u.userId &&
                          setCanTranslate.mutate({
                            userId: u.userId,
                            canTranslate: !u.canTranslate,
                          })
                        }
                      />
                    )}
                  </td>

                  {/* Actions — head only: delete a login (the tutor record is preserved). */}
                  {isHead && (
                    <td>
                      {u.userId && !u.isSelf && u.role !== "HEAD" ? (
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
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isHead ? 7 : 6} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Errors from the dangerous (dialog-gated) actions surface inside the dialog itself. */}
      {(setCanTutor.error ?? setCanTranslate.error ?? sendSetup.error) && (
        <p className="text-sm text-red-600">
          {
            (setCanTutor.error ?? setCanTranslate.error ?? sendSetup.error)
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
