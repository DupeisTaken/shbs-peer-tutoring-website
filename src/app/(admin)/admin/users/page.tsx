"use client";

import { accountMembership } from "~/lib/account-membership";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { UserDetails } from "./user-details";
import { LoginSetup, MembershipBadges } from "./presentation";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import Link from "next/link";
import { CombineAccounts } from "~/app/_components/combine-accounts";
import { AccountProfileEditor } from "~/app/_components/account-profile-editor";
import { TutorProfileEditor } from "~/app/_components/tutor-profile-editor";
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
import {
  SummaryTable,
  TableActions,
  TableAction,
} from "~/app/_components/ui/summary-table";

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
  const [editingTutorId, setEditingTutorId] = useState<string | null>(null);
  // Fetch the full roster record only when staff open an unlinked profile.
  const tutorProfiles = api.admin.tutors.useQuery(undefined, {
    enabled: !!editingTutorId,
  });
  const editingTutor = tutorProfiles.data?.find(
    (row) => row.id === editingTutorId,
  );
  const editingProfile = accounts.data?.rows.find(
    (row) => row.userId === editingProfileId,
  );
  const invalidate = () => utils.admin.accounts.invalidate();

  // Designed confirm/prompt dialog (replaces native window.prompt for the suspension reason).
  const { promptText, confirm: confirmUsername, dialog } = useDialog();
  const assignUsername = api.admin.backfillStudentUsernames.useMutation({
    onSuccess: async () => {
      await Promise.all([invalidate(), utils.account.me.invalidate()]);
    },
  });

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
        emailed: data.emailed,
      }),
  });
  const [setupInfo, setSetupInfo] = useState<{
    tutorId: string;
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
      if (raw !== null)
        localStorage.setItem(
          `shbs:user-filters:${viewerId}:v1`,
          JSON.stringify(restored),
        );
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

  return (
    <div className="space-y-6">
      {editingTutor && !editingTutor.user && (
        <TutorProfileEditor
          key={editingTutor.id}
          row={editingTutor}
          isHead={isHead}
          onClose={() => setEditingTutorId(null)}
        />
      )}
      {editingTutorId && tutorProfiles.isLoading && (
        <p role="status">{t("common.loading")}</p>
      )}
      {editingTutorId && tutorProfiles.error && (
        <p role="alert">{tutorProfiles.error.message}</p>
      )}
      {editingProfile?.userId && editingProfile.profileVersion !== null && (
        <AccountProfileEditor
          profile={{
            userId: editingProfile.userId,
            username: editingProfile.username,
            name: editingProfile.name,
            firstName: editingProfile.firstName,
            lastName: editingProfile.lastName,
            preferredName: editingProfile.preferredName,
            legacyName: editingProfile.legacyName,
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

      <section className="card space-y-3 p-4 text-sm">
        <p>{t("usersDirectory.intro")}</p>
        <DisclosureSection title={t("usersDirectory.pathways")} lifetime="lazy">
          <div className="space-y-3 pt-3 text-slate-700">
            <p>
              {t("usersDirectory.pathwaysTutee")}{" "}
              <Link href="/admin/tutees" className="link">
                {t("usersDirectory.tuteeList")}
              </Link>
            </p>
            <p>
              {t("usersDirectory.pathwaysInvite")}{" "}
              <Link href="/admin/registration-codes" className="link">
                {t("usersDirectory.invitations")}
              </Link>
            </p>
            <p>{t("usersDirectory.pathwaysExisting")}</p>
            <p>{t("usersDirectory.pathwaysHistory")}</p>
          </div>
        </DisclosureSection>
      </section>
      {isHead && <CombineAccounts />}
      <section className="card space-y-3 p-4">
        <p className="muted text-sm">{t("userMultiFilters.hint")}</p>
        <p className="muted text-sm">{t("usersDirectory.visibility")}</p>
        <div
          className={`grid items-start gap-3 ${isTutorStatusApplicable(filters.role) ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
          <MultiFilter
            label={t("admin.users.filters.role")}
            options={[
              ...ALL_ROLES.map((value) => ({
                value,
                label:
                  value === "TRANSLATOR"
                    ? t("membership.translator")
                    : t(`admin.users.roles.${value}`),
              })),
              { value: "__none__", label: t("userMultiFilters.noRole") },
            ]}
            value={filters.role}
            onChange={(role) => updateFilters({ ...filters, role })}
          />
          {isTutorStatusApplicable(filters.role) && (
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
          )}
          <MultiFilter
            label={t("admin.users.filters.account")}
            options={ACCOUNT_STATES.map((value) => ({
              value,
              label: t(`usersDirectory.setup.${value}`),
            }))}
            value={filters.account}
            onChange={(account) => updateFilters({ ...filters, account })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="muted text-sm">
            {t("usersDirectory.count", {
              count: rows.length,
              total: accounts.data?.rows.length ?? 0,
              hidden: (accounts.data?.rows.length ?? 0) - rows.length,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm min-h-11 lg:min-h-8"
              aria-pressed={filters.showUnverified}
              onClick={() =>
                updateFilters({
                  ...filters,
                  showUnverified: !filters.showUnverified,
                })
              }
            >
              {t(
                filters.showUnverified
                  ? "tuteeHistory.hideUnverified"
                  : "tuteeHistory.showUnverified",
              )}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm min-h-11 lg:min-h-8"
              aria-pressed={filters.showPastTutors}
              onClick={() =>
                updateFilters({
                  ...filters,
                  showPastTutors: !filters.showPastTutors,
                })
              }
            >
              {t(
                filters.showPastTutors
                  ? "tuteeHistory.hideHistorical"
                  : "tuteeHistory.showHistorical",
              )}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm min-h-11 lg:min-h-8"
              onClick={() => updateFilters(emptyUserFilters())}
            >
              {t("userMultiFilters.clear")}
            </button>
          </div>
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

      {assignUsername.error && (
        <p role="alert" className="text-sm text-red-600">
          {assignUsername.error.message}
        </p>
      )}
      {accounts.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={accounts.isFetching}
              onClick={() => void accounts.refetch()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      )}
      {accounts.data && accounts.isFetching && (
        <p role="status" className="muted text-sm">
          {t("common.loading")}
        </p>
      )}
      <div className="card">
        <SummaryTable label={t("admin.users.title")}>
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="name">
                {t("admin.users.columns.user")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="account">
                {t("usersDirectory.loginSetup")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="role">
                {t("usersDirectory.rolesParticipation")}
              </SortHeader>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {!accounts.data && !accounts.error && (
              <tr>
                <td colSpan={4}>
                  <StatePanel kind="loading" title={t("common.loading")} />
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const key = u.userId ?? `tutor-${u.tutorId}`;
              return (
                <tr key={key}>
                  {/* Identity contains names and the handle; all row actions live in the last column. */}
                  <td>
                    <div className="leading-tight">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      {(u.username ?? u.tutor?.username) ? (
                        <p className="muted text-xs">
                          @{u.username ?? u.tutor?.username}
                        </p>
                      ) : (
                        <p className="muted text-xs">
                          {t(
                            u.userId
                              ? "academics.usernameMissing"
                              : "tuteeHistory.noAccount",
                          )}
                        </p>
                      )}
                    </div>
                  </td>

                  <td className="max-w-56">
                    <LoginSetup account={u.account} suspended={u.suspended} />
                  </td>
                  <td className="max-w-56">
                    <MembershipBadges membership={accountMembership(u)} />
                  </td>

                  {/* Contact/profile actions stay available to permitted staff. Only deletion is head-only. */}
                  <TableActions>
                    <UserDetails row={u} />
                    {/* Registered accounts recover access themselves; only unfinished tutor logins are provisioned. */}
                    {u.tutorId &&
                      (u.account === "none" || u.account === "setup") && (
                        <TableAction
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
                        </TableAction>
                      )}
                    {!u.tutorId &&
                      u.role === "VIEWER" &&
                      u.userId &&
                      !u.isSelf &&
                      (u.suspended ? (
                        <TableAction
                          disabled={reinstateUser.isPending}
                          onClick={() =>
                            reinstateUser.mutate({ userId: u.userId })
                          }
                        >
                          {t("admin.users.reinstate")}
                        </TableAction>
                      ) : (
                        <TableAction
                          className="text-red-600"
                          disabled={suspendUser.isPending}
                          onClick={async () => {
                            const reason = await promptText({
                              title: t("admin.users.suspendTitle"),
                              reasonLabel: t("admin.users.suspendPrompt"),
                              confirmLabel: t("admin.users.suspend"),
                              cancelLabel: t("common.cancel"),
                              danger: true,
                            });
                            if (reason === null || !u.userId) return;
                            suspendUser.mutate({
                              userId: u.userId,
                              reason: reason.length > 0 ? reason : undefined,
                            });
                          }}
                        >
                          {t("admin.users.suspend")}
                        </TableAction>
                      ))}
                    {u.userId && (
                      <TableAction
                        onClick={() => setEditingProfileId(u.userId)}
                      >
                        {t("accountProfile.editProfile")}
                      </TableAction>
                    )}
                    {!u.userId && u.tutorId && (
                      <TableAction onClick={() => setEditingTutorId(u.tutorId)}>
                        {t("accountProfile.editProfile")}
                      </TableAction>
                    )}
                    {isHead &&
                      u.userId &&
                      u.role === "STUDENT" &&
                      u.emailVerifiedAt &&
                      !u.username && (
                        <TableAction
                          disabled={assignUsername.isPending}
                          onClick={async () => {
                            if (!u.userId) return;
                            if (
                              await confirmUsername({
                                title: t("identityUsername.assignTitle", {
                                  name: u.name,
                                }),
                                message: t("identityUsername.assignHelp"),
                                confirmLabel: t("identityUsername.assign"),
                                cancelLabel: t("common.cancel"),
                              })
                            )
                              assignUsername.mutate({ userIds: [u.userId] });
                          }}
                        >
                          {t("identityUsername.assign")}
                        </TableAction>
                      )}
                    {isHead && u.userId && !u.isSelf && u.role !== "HEAD" ? (
                      <TableAction
                        className="text-red-600"
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
                      </TableAction>
                    ) : null}
                  </TableActions>
                </tr>
              );
            })}
            {accounts.data && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </SummaryTable>
      </div>
      {/* Errors from the dangerous (dialog-gated) actions surface inside the dialog itself. */}
      {sendSetup.error && (
        <p className="text-sm text-red-600">{sendSetup.error?.message}</p>
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
