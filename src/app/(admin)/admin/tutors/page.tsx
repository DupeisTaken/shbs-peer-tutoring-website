"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export default function TutorsPage() {
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const invalidate = () => utils.admin.tutors.invalidate();
  const create = api.admin.createTutor.useMutation({
    onSuccess: async () => {
      setName("");
      setEmail("");
      await invalidate();
    },
  });
  const update = api.admin.updateTutor.useMutation({ onSuccess: invalidate });

  return (
    <div>
      <h1 className="text-2xl font-bold">Tutors</h1>

      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim())
            create.mutate({ englishName: name.trim(), email: email.trim() || undefined });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="English name"
          className="rounded border px-3 py-2"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          className="w-64 rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Add tutor
        </button>
      </form>

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Name</th>
            <th className="p-3">Email</th>
            <th className="p-3">Active</th>
          </tr>
        </thead>
        <tbody>
          {(tutors.data ?? []).map((t) => (
            <tr key={t.id} className="border-b">
              <td className="p-3">
                <input
                  defaultValue={t.englishName}
                  className="rounded border px-2 py-1"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== t.englishName)
                      update.mutate({
                        id: t.id,
                        englishName: e.target.value.trim(),
                        email: t.email,
                        active: t.active,
                      });
                  }}
                />
              </td>
              <td className="p-3">
                <input
                  defaultValue={t.email ?? ""}
                  type="email"
                  placeholder="—"
                  className="w-64 rounded border px-2 py-1"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (t.email ?? ""))
                      update.mutate({
                        id: t.id,
                        englishName: t.englishName,
                        email: v || null,
                        active: t.active,
                      });
                  }}
                />
              </td>
              <td className="p-3">
                <input
                  type="checkbox"
                  checked={t.active}
                  onChange={(e) =>
                    update.mutate({
                      id: t.id,
                      englishName: t.englishName,
                      email: t.email,
                      active: e.target.checked,
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
