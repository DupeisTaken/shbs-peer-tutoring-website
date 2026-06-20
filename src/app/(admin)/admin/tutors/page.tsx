"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export default function TutorsPage() {
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [email, setEmail] = useState("");

  const invalidate = () => utils.admin.tutors.invalidate();
  const create = api.admin.createTutor.useMutation({
    onSuccess: async () => {
      setFirstName("");
      setLastName("");
      setAltNames("");
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
          A tutor&apos;s email links them to their login account at first sign-in. The
          username (default: first initial + last name) is an alternate sign-in identifier.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (firstName.trim() && lastName.trim())
            create.mutate({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              alternativeNames: altNames.trim() || undefined,
              email: email.trim() || undefined,
            });
        }}
      >
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          className="input max-w-[10rem]"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="input max-w-[10rem]"
        />
        <input
          value={altNames}
          onChange={(e) => setAltNames(e.target.value)}
          placeholder="Alt. name(s) e.g. 中文名"
          className="input max-w-[12rem]"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional)"
          className="input max-w-xs"
        />
        <button className="btn-primary" disabled={create.isPending}>
          Add tutor
        </button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>First name</th>
              <th>Last name</th>
              <th>Alt. name(s)</th>
              <th>Username</th>
              <th>Email</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {(tutors.data ?? []).map((t) => {
              // Fall back to splitting englishName for any legacy row missing first/last.
              const [efirst, ...erest] = t.englishName.trim().split(/\s+/);
              const restJoined = erest.join(" ");
              const baseFirst = t.firstName ?? efirst ?? t.englishName;
              const baseLast =
                t.lastName ?? (restJoined.length > 0 ? restJoined : (efirst ?? "—"));
              // Build a full update payload from this row's current values + one change.
              const save = (patch: Partial<{
                firstName: string;
                lastName: string;
                alternativeNames: string | null;
                username: string;
                email: string | null;
                active: boolean;
              }>) =>
                update.mutate({
                  id: t.id,
                  firstName: patch.firstName ?? baseFirst,
                  lastName: patch.lastName ?? baseLast,
                  alternativeNames:
                    patch.alternativeNames !== undefined
                      ? patch.alternativeNames
                      : t.alternativeNames,
                  username: patch.username ?? t.username ?? undefined,
                  email: patch.email !== undefined ? patch.email : t.email,
                  active: patch.active ?? t.active,
                });
              return (
                <tr key={t.id}>
                  <td>
                    <input
                      defaultValue={t.firstName ?? ""}
                      className="input max-w-[9rem]"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== (t.firstName ?? "")) save({ firstName: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={t.lastName ?? ""}
                      className="input max-w-[9rem]"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== (t.lastName ?? "")) save({ lastName: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={t.alternativeNames ?? ""}
                      placeholder="—"
                      lang="zh"
                      className="input max-w-[10rem]"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (t.alternativeNames ?? ""))
                          save({ alternativeNames: v || null });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={t.username ?? ""}
                      placeholder="—"
                      className="input max-w-[9rem]"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (t.username ?? "")) save({ username: v });
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
                        if (v !== (t.email ?? "")) save({ email: v || null });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.active}
                      onChange={(e) => save({ active: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
