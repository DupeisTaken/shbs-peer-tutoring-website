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
    <div>
      <h1 className="text-2xl font-bold">Users &amp; roles</h1>
      <p className="mt-1 text-sm text-gray-500">
        Administrators only. Roles take effect on the user&apos;s next sign-in.
      </p>

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Name</th>
            <th className="p-3">Email</th>
            <th className="p-3">Linked tutor</th>
            <th className="p-3">Role</th>
          </tr>
        </thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.id} className="border-b">
              <td className="p-3">{u.name}</td>
              <td className="p-3">{u.email}</td>
              <td className="p-3">{u.tutor?.englishName ?? "—"}</td>
              <td className="p-3">
                <select
                  value={u.role}
                  onChange={(e) =>
                    setRole.mutate({ userId: u.id, role: e.target.value as RoleValue })
                  }
                  className="rounded border px-2 py-1"
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
              <td colSpan={4} className="p-4 text-gray-500">
                No users have signed in yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
