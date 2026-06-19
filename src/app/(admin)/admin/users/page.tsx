"use client";

import { api } from "~/trpc/react";

const ROLES = ["TUTOR", "COORDINATOR", "ADMIN"] as const;
type RoleValue = (typeof ROLES)[number];

export default function UsersPage() {
  const utils = api.useUtils();
  const users = api.admin.users.useQuery();
  const setRole = api.admin.setUserRole.useMutation({
    onSuccess: () => utils.admin.users.invalidate(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Users &amp; roles</h1>
        <p className="muted mt-1">
          Administrators only. Roles take effect on the user&apos;s next sign-in.
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Linked tutor</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td className="text-slate-600">{u.tutor?.englishName ?? "—"}</td>
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
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {users.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  No users have signed in yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
