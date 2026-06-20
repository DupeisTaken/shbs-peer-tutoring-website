"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { graduationYear } from "~/lib/period";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";

export default function TutorsPage() {
  const t = useTranslations();
  // Alias: the row map below shadows `t` with the tutor record, so use `tt` for translations there.
  const tt = t;
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const currentPeriod = api.admin.currentPeriod.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const schoolYear = currentPeriod.data?.schoolYear;
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");

  const sort = useSort("lastName");

  const invalidate = () => utils.admin.tutors.invalidate();
  const create = api.admin.createTutor.useMutation({
    onSuccess: async () => {
      setFirstName("");
      setLastName("");
      setAltNames("");
      setEmail("");
      setGrade("");
      await invalidate();
    },
  });
  const update = api.admin.updateTutor.useMutation({ onSuccess: invalidate });

  const rows = useMemo(() => {
    const data = tutors.data ?? [];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      switch (sort.key) {
        case "firstName":
          return compare(a.firstName ?? a.englishName, b.firstName ?? b.englishName) * dir;
        case "username":
          return compare(a.username ?? "", b.username ?? "") * dir;
        case "email":
          return compare(a.email ?? "", b.email ?? "") * dir;
        case "grade":
          return ((a.gradeLevel ?? 0) - (b.gradeLevel ?? 0)) * dir;
        case "active":
          return (Number(a.active) - Number(b.active)) * dir;
        case "lastName":
        default:
          return compare(a.lastName ?? a.englishName, b.lastName ?? b.englishName) * dir;
      }
    });
  }, [tutors.data, sort.key, sort.dir]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.tutors.title")}</h1>
        <p className="muted mt-1">{t("admin.tutors.help")}</p>
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
              gradeLevel: grade.trim() ? Number(grade) : undefined,
            });
        }}
      >
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t("admin.tutors.phFirstName")}
          className="input max-w-[10rem]"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t("admin.tutors.phLastName")}
          className="input max-w-[10rem]"
        />
        <input
          value={altNames}
          onChange={(e) => setAltNames(e.target.value)}
          placeholder={t("admin.tutors.phAltNames")}
          className="input max-w-[12rem]"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder={t("admin.tutors.phEmail")}
          className="input max-w-xs"
        />
        <input
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          type="number"
          min={6}
          max={12}
          placeholder={t("admin.tutors.phGrade")}
          className="input w-24"
        />
        <button className="btn-primary" disabled={create.isPending}>
          {t("admin.tutors.addTutor")}
        </button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="firstName">{t("admin.tutors.colFirstName")}</SortHeader>
              <SortHeader sort={sort} sortKey="lastName">{t("admin.tutors.colLastName")}</SortHeader>
              <th>{t("admin.tutors.colAltNames")}</th>
              <SortHeader sort={sort} sortKey="username">{t("admin.tutors.colUsername")}</SortHeader>
              <SortHeader sort={sort} sortKey="email">{t("admin.tutors.colEmail")}</SortHeader>
              <SortHeader sort={sort} sortKey="grade">{t("admin.tutors.colGrade")}</SortHeader>
              <SortHeader sort={sort} sortKey="active">{t("admin.tutors.colActive")}</SortHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
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
                gradeLevel: number | null;
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
                  gradeLevel:
                    patch.gradeLevel !== undefined ? patch.gradeLevel : t.gradeLevel,
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
                      defaultValue={t.gradeLevel ?? ""}
                      type="number"
                      min={6}
                      max={12}
                      placeholder="—"
                      className="input w-16"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === "" ? null : Number(raw);
                        if (v !== (t.gradeLevel ?? null)) save({ gradeLevel: v });
                      }}
                    />
                    {t.gradeLevel != null && schoolYear && (
                      <span className="muted ml-1 text-xs whitespace-nowrap">
                        {tt("admin.tutors.classOf", {
                          year: graduationYear(t.gradeLevel, schoolYear),
                        })}
                      </span>
                    )}
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
