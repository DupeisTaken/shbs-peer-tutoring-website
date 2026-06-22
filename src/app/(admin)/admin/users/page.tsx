"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";

const ROLES = ["VIEWER", "TUTOR", "COORDINATOR", "ADMIN"] as const;
type RoleValue = (typeof ROLES)[number];

/** Elevated roles: they live in the admin area and can translate by default (no flag needed). */
const ELEVATED_ROLES: readonly string[] = ["COORDINATOR", "ADMIN"];

export default function UsersPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const accounts = api.admin.accounts.useQuery();
  const invalidate = () => utils.admin.accounts.invalidate();

  const setRole = api.admin.setUserRole.useMutation({ onSuccess: invalidate });
  const setCanTutor = api.admin.setUserCanTutor.useMutation({ onSuccess: invalidate });
  const setCanTranslate = api.admin.setUserCanTranslate.useMutation({ onSuccess: invalidate });
  const sendSetup = api.admin.sendTutorSetup.useMutation({
    onSuccess: (data, variables) =>
      setSetupInfo({ tutorId: variables.tutorId, link: data.link, emailed: data.emailed }),
  });
  const [setupInfo, setSetupInfo] = useState<
    { tutorId: string; link: string; emailed: boolean } | null
  >(null);

  const isAdmin = accounts.data?.caller.role === "ADMIN";
  const sort = useSort("name");

  const rows = useMemo(() => {
    const data = accounts.data?.rows ?? [];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
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
  }, [accounts.data, sort.key, sort.dir]);

  const accountBadge = (status: string) =>
    status === "active" ? "badge-green" : status === "pending" ? "badge-amber" : "badge-slate";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <p className="muted mt-1">
          {isAdmin ? t("admin.users.subtitle") : t("admin.users.coordinatorHint")}
        </p>
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
              const linkedActive = !!u.tutorId && u.tutor?.active !== false;
              // Coordinators may only flip their own "can tutor"; admins, anyone's.
              const canEditCanTutor = isAdmin || u.isSelf;
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

                  {/* Linked tutor: name, class-of year + grade, active state. */}
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
                          {u.tutor.active
                            ? t("admin.users.tutorActive")
                            : t("admin.users.tutorInactive")}
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
                        <div>
                          <button
                            className="link text-xs whitespace-nowrap"
                            disabled={!u.tutorHasEmail || sendSetup.isPending}
                            title={
                              !u.tutorHasEmail ? t("admin.tutors.account.needEmail") : undefined
                            }
                            onClick={() => sendSetup.mutate({ tutorId: u.tutorId! })}
                          >
                            {u.account === "active"
                              ? t("admin.tutors.account.resend")
                              : t("admin.tutors.account.sendSetup")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Role — admins only; coordinators see it read-only. */}
                  <td>
                    {u.role == null ? (
                      <span className="text-slate-400">—</span>
                    ) : isAdmin && u.userId ? (
                      <select
                        value={u.role}
                        onChange={(e) =>
                          setRole.mutate({ userId: u.userId, role: e.target.value as RoleValue })
                        }
                        className="select field-auto min-w-36"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`admin.users.roles.${r}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="badge-slate">{t(`admin.users.roles.${u.role}`)}</span>
                    )}
                  </td>

                  {/* Can tutor — admins for anyone; coordinators only for themselves. */}
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
                            setCanTutor.mutate({ userId: u.userId, canTutor: e.target.checked })
                          }
                        />
                        {t("admin.users.canTutorLabel")}
                      </label>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Can translate — admins/coordinators always can (default); others are assignable. */}
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
                          isAdmin ? "text-slate-700" : "text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={u.canTranslate}
                          disabled={!isAdmin || setCanTranslate.isPending}
                          onChange={(e) =>
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
      {(setRole.error ?? setCanTutor.error ?? setCanTranslate.error ?? sendSetup.error) && (
        <p className="text-sm text-red-600">
          {(setRole.error ?? setCanTutor.error ?? setCanTranslate.error ?? sendSetup.error)?.message}
        </p>
      )}
    </div>
  );
}
