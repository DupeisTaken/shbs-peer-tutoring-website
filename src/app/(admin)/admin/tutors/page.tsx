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
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Tutors</h1>
        <p className="muted mt-1">
          A tutor&apos;s email links them to their login account at first sign-in.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
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
          className="input max-w-xs"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          className="input max-w-xs"
        />
        <button className="btn-primary">Add tutor</button>
      </form>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {(tutors.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    defaultValue={t.englishName}
                    className="input max-w-[12rem]"
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
                <td>
                  <input
                    defaultValue={t.email ?? ""}
                    type="email"
                    placeholder="—"
                    className="input max-w-xs"
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
                <td>
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
    </div>
  );
}
