"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";

/** Roles an admin/head may assign via the dropdown (HEAD is set only via leadership transfer). */
const ASSIGNABLE_ROLES = ["VIEWER", "TUTOR", "COORDINATOR", "ADMIN"] as const;
type RoleValue = (typeof ASSIGNABLE_ROLES)[number];

const ALL_ROLES = ["VIEWER", "TUTOR", "COORDINATOR", "ADMIN", "HEAD"] as const;
const TUTOR_STATUSES = ["ACTIVE", "PENDING", "GRADUATED", "OPTED_OUT", "ARCHIVED"] as const;
const ACCOUNT_STATES = ["registered", "setup", "invited", "none"] as const;

/** Elevated roles: they live in the admin area and can translate by default (no flag needed). */
const ELEVATED_ROLES: readonly string[] = ["COORDINATOR", "ADMIN", "HEAD"];

export default function UsersPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const accounts = api.admin.accounts.useQuery();
  const invalidate = () => utils.admin.accounts.invalidate();

  const setRole = api.admin.setUserRole.useMutation({ onSuccess: invalidate });
  const transferHead = api.admin.transferHead.useMutation({ onSuccess: invalidate });
  const setCanTutor = api.admin.setUserCanTutor.useMutation({ onSuccess: invalidate });
  const setCanTranslate = api.admin.setUserCanTranslate.useMutation({ onSuccess: invalidate });
  const sendSetup = api.admin.sendTutorSetup.useMutation({
    onSuccess: (data, variables) =>
      setSetupInfo({ tutorId: variables.tutorId, link: data.link, emailed: data.emailed }),
  });
  const [setupInfo, setSetupInfo] = useState<
    { tutorId: string; link: string; emailed: boolean } | null
  >(null);

  const callerRole = accounts.data?.caller.role;
  const isHead = callerRole === "HEAD";
  const isAdminTier = isHead || callerRole === "ADMIN";
  const sort = useSort("name");

  // Filters.
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const rows = useMemo(() => {
    const data = accounts.data?.rows ?? [];
    const filtered = data.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.tutorStatus !== statusFilter) return false;
      if (accountFilter !== "all" && u.account !== accountFilter) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "tutor":
          return compare(a.tutor?.englishName ?? "", b.tutor?.englishName ?? "") * dir;
        case "account":
          return compare(a.account, b.account) * dir;
        case "role":
          return compare(a.role ?? "", b.role ?? "") * dir;
        case "name":
        default:
          return compare(a.name, b.name) * dir;
      }
    });
  }, [accounts.data, sort.key, sort.dir, roleFilter, statusFilter, accountFilter]);

  const accountBadge = (status: string) =>
    status === "registered"
      ? "badge-green"
      : status === "none"
        ? "badge-slate"
        : "badge-amber";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <p className="muted mt-1">
          {isAdminTier ? t("admin.users.subtitle") : t("admin.users.coordinatorHint")}
        </p>
      </div>

      {/* Filters: role · tutor status · account state */}
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="label">{t("admin.users.filters.role")}</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="select field-auto min-w-32"
          >
            <option value="all">{t("admin.users.filters.all")}</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.users.roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">{t("admin.users.filters.status")}</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="select field-auto min-w-32"
          >
            <option value="all">{t("admin.users.filters.all")}</option>
            {TUTOR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.tutorStatus.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">{t("admin.users.filters.account")}</span>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="select field-auto min-w-32"
          >
            <option value="all">{t("admin.users.filters.all")}</option>
            {ACCOUNT_STATES.map((a) => (
              <option key={a} value={a}>
                {t(`admin.tutors.account.${a}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

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

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="name">{t("admin.users.columns.user")}</SortHeader>
              <SortHeader sort={sort} sortKey="tutor">{t("admin.users.columns.linkedTutor")}</SortHeader>
              <SortHeader sort={sort} sortKey="account">{t("admin.users.columns.account")}</SortHeader>
              <SortHeader sort={sort} sortKey="role">{t("admin.users.columns.role")}</SortHeader>
              <th>{t("admin.users.columns.canTutor")}</th>
              <th>{t("admin.users.columns.canTranslate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const key = u.userId ?? `tutor-${u.tutorId}`;
              const canTutorApplies = !!u.role && ELEVATED_ROLES.includes(u.role);
              const linkedActive = !!u.tutorId && u.tutorStatus === "ACTIVE";
              // Coordinators may only flip their own "can tutor"; the admin tier, anyone's.
              const canEditCanTutor = isAdminTier || u.isSelf;
              // Only the head may change an admin's role or promote to admin.
              const targetIsAdminTier = u.role === "ADMIN" || u.role === "HEAD";
              const canEditRole = isAdminTier && !!u.userId && u.role !== "HEAD" && (isHead || !targetIsAdminTier);
              const roleOptions = isHead
                ? ASSIGNABLE_ROLES
                : ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN");
              return (
                <tr key={key}>
                  {/* Identity: name, username, email stacked together. */}
                  <td>
                    <div className="leading-tight">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      {u.tutor?.username && (
                        <p className="muted text-xs">@{u.tutor.username}</p>
                      )}
                      <p className="muted text-xs">{u.email ?? "—"}</p>
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
                          {u.tutorStatus ? t(`admin.tutorStatus.${u.tutorStatus}`) : ""}
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
                        {u.account !== "invited" && (
                          <div>
                            <button
                              className="link text-xs whitespace-nowrap"
                              disabled={!u.tutorHasEmail || sendSetup.isPending}
                              title={
                                !u.tutorHasEmail ? t("admin.tutors.account.needEmail") : undefined
                              }
                              onClick={() => u.tutorId && sendSetup.mutate({ tutorId: u.tutorId })}
                            >
                              {u.account === "registered"
                                ? t("admin.tutors.account.resend")
                                : t("admin.tutors.account.sendSetup")}
                            </button>
                          </div>
                        )}
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
                      <div className="space-y-1 leading-tight">
                        {u.role === "HEAD" ? (
                          <span className="badge-green">{t("admin.users.roles.HEAD")}</span>
                        ) : canEditRole ? (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              u.userId &&
                              setRole.mutate({ userId: u.userId, role: e.target.value as RoleValue })
                            }
                            className="select field-auto min-w-36"
                          >
                            {roleOptions.map((r) => (
                              <option key={r} value={r}>
                                {t(`admin.users.roles.${r}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge-slate">{t(`admin.users.roles.${u.role}`)}</span>
                        )}
                        {/* Leadership transfer (head only) to an admin/coordinator. */}
                        {isHead &&
                          !u.isSelf &&
                          u.userId &&
                          (u.role === "ADMIN" || u.role === "COORDINATOR") && (
                            <button
                              className="link text-xs whitespace-nowrap"
                              disabled={transferHead.isPending}
                              onClick={() => {
                                if (
                                  u.userId &&
                                  window.confirm(t("admin.users.confirmTransfer", { name: u.name }))
                                ) {
                                  transferHead.mutate({ userId: u.userId });
                                }
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
                      <label
                        className={`flex items-center gap-2 text-sm ${
                          canEditCanTutor ? "text-slate-700" : "text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={linkedActive}
                          disabled={!canEditCanTutor || setCanTutor.isPending}
                          onChange={(e) =>
                            u.userId &&
                            setCanTutor.mutate({ userId: u.userId, canTutor: e.target.checked })
                          }
                        />
                        {t("admin.users.canTutorLabel")}
                      </label>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Can translate — admins/coordinators always can (default); others assignable. */}
                  <td>
                    {u.role == null ? (
                      <span className="text-slate-400">—</span>
                    ) : ELEVATED_ROLES.includes(u.role) ? (
                      <span className="badge-slate" title={t("admin.users.translateDefaultHint")}>
                        {t("admin.users.translateDefault")}
                      </span>
                    ) : (
                      <label
                        className={`flex items-center gap-2 text-sm ${
                          isAdminTier ? "text-slate-700" : "text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={u.canTranslate}
                          disabled={!isAdminTier || setCanTranslate.isPending}
                          onChange={(e) =>
                            u.userId &&
                            setCanTranslate.mutate({
                              userId: u.userId,
                              canTranslate: e.target.checked,
                            })
                          }
                        />
                        {t("admin.users.canTranslateLabel")}
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(setRole.error ?? transferHead.error ?? setCanTutor.error ?? setCanTranslate.error ?? sendSetup.error) && (
        <p className="text-sm text-red-600">
          {
            (setRole.error ?? transferHead.error ?? setCanTutor.error ?? setCanTranslate.error ??
              sendSetup.error)?.message
          }
        </p>
      )}
    </div>
  );
}
