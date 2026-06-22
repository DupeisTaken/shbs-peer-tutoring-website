"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

const ROLES = ["VIEWER", "TUTOR", "COORDINATOR", "ADMIN"] as const;
type RoleValue = (typeof ROLES)[number];

/** Roles for which "also a tutor" makes sense (they primarily live in the admin area). */
const CAN_TUTOR_ROLES = ["COORDINATOR", "ADMIN"];

export default function UsersPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const users = api.admin.users.useQuery();
  const setRole = api.admin.setUserRole.useMutation({
    onSuccess: () => utils.admin.users.invalidate(),
  });
  const setCanTutor = api.admin.setUserCanTutor.useMutation({
    onSuccess: () => utils.admin.users.invalidate(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.users.title")}</h1>
        <p className="muted mt-1">{t("admin.users.subtitle")}</p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.users.columns.user")}</th>
              <th>{t("admin.users.columns.linkedTutor")}</th>
              <th>{t("admin.users.columns.role")}</th>
              <th>{t("admin.users.columns.canTutor")}</th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => {
              const canTutorApplies = CAN_TUTOR_ROLES.includes(u.role);
              const linkedActive = !!u.tutorId && u.tutor?.active !== false;
              return (
                <tr key={u.id}>
                  {/* User identity: name, username, email stacked together. */}
                  <td>
                    <div className="leading-tight">
                      <p className="font-medium text-slate-900">{u.name ?? "—"}</p>
                      {u.tutor?.username && (
                        <p className="muted text-xs">@{u.tutor.username}</p>
                      )}
                      <p className="muted text-xs">{u.email}</p>
                    </div>
                  </td>
                  <td className="text-slate-600">
                    {u.tutor ? (
                      <div className="leading-tight">
                        <p>{u.tutor.englishName}</p>
                        <p className="muted text-xs">
                          {u.tutor.gradeLevel != null && `G${u.tutor.gradeLevel} · `}
                          {u.tutor.active
                            ? t("admin.users.tutorActive")
                            : t("admin.users.tutorInactive")}
                        </p>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) =>
                        setRole.mutate({ userId: u.id, role: e.target.value as RoleValue })
                      }
                      className="select w-36"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`admin.users.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {canTutorApplies ? (
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={linkedActive}
                          disabled={setCanTutor.isPending}
                          onChange={(e) =>
                            setCanTutor.mutate({ userId: u.id, canTutor: e.target.checked })
                          }
                        />
                        {t("admin.users.canTutorLabel")}
                      </label>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  {t("admin.users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(setRole.error ?? setCanTutor.error) && (
        <p className="text-sm text-red-600">
          {(setRole.error ?? setCanTutor.error)?.message}
        </p>
      )}
    </div>
  );
}
