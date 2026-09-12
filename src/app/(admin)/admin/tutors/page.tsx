"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmailDetails } from "~/app/_components/email-details";
import { TutorProfileEditor } from "~/app/_components/tutor-profile-editor";
import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useReadOnly } from "~/app/_components/read-only";

export default function TutorsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  // Translate a tutor status outside the row map, where `t` is shadowed by the row variable.
  const statusLabel = (s: string) => t(`admin.tutorStatus.${s}`);
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = tutors.data?.find((row) => row.id === editingId);

  const rows = useMemo(() => {
    const data = tutors.data ?? [];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      switch (sort.key) {
        case "firstName":
          return (
            compare(
              a.firstName ?? a.englishName,
              b.firstName ?? b.englishName,
            ) * dir
          );
        case "username":
          return compare(a.username ?? "", b.username ?? "") * dir;
        case "email":
          return compare(a.email ?? "", b.email ?? "") * dir;
        case "grade":
          return ((a.gradeLevel ?? 0) - (b.gradeLevel ?? 0)) * dir;
        case "status":
          return compare(a.status, b.status) * dir;
        case "lastName":
        default:
          return (
            compare(a.lastName ?? a.englishName, b.lastName ?? b.englishName) *
            dir
          );
      }
    });
  }, [tutors.data, sort.key, sort.dir]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.tutors.title")}</h1>
        <p className="muted mt-1">{t("admin.tutors.help")}</p>
      </div>

      {!readOnly && (
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
            className="input field-auto min-w-36"
          />
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t("admin.tutors.phLastName")}
            className="input field-auto min-w-36"
          />
          <input
            value={altNames}
            onChange={(e) => setAltNames(e.target.value)}
            placeholder={t("admin.tutors.phAltNames")}
            className="input field-auto min-w-40"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder={t("admin.tutors.phEmail")}
            className="input field-auto min-w-48"
          />
          <input
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            type="number"
            min={6}
            max={12}
            placeholder={t("admin.tutors.phGrade")}
            className="input field-auto min-w-20"
          />
          <button
            className="btn-primary"
            disabled={!firstName.trim() || !lastName.trim() || create.isPending}
          >
            {t("admin.tutors.addTutor")}
          </button>
        </form>
      )}
      {!readOnly && create.error && (
        <p className="text-sm text-red-600">{create.error.message}</p>
      )}
      <p className="muted text-xs">{t("admin.tutors.accountMovedNote")}</p>

      {editing && !readOnly && (
        <TutorProfileEditor
          key={editing.id}
          row={editing}
          onClose={() => setEditingId(null)}
        />
      )}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="firstName">
                {t("accountProfile.name")}
              </SortHeader>
              <th>{t("admin.tutors.colEmail")}</th>
              <SortHeader sort={sort} sortKey="grade">
                {t("admin.tutors.colGrade")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="status">
                {t("admin.tutors.colStatus")}
              </SortHeader>
              <th>
                <span className="sr-only">
                  {t("accountProfile.editProfile")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="max-w-60 min-w-40">
                  <p className="font-medium [overflow-wrap:anywhere] text-slate-900">
                    {row.englishName}
                  </p>
                  {row.alternativeNames && (
                    <p className="muted text-xs [overflow-wrap:anywhere]">
                      {row.alternativeNames}
                    </p>
                  )}
                  {row.username && (
                    <p className="muted mt-1 text-xs">@{row.username}</p>
                  )}
                  {!row.user && (
                    <p className="muted mt-1 text-xs">
                      {t("accountProfile.setupRequired")}
                    </p>
                  )}
                </td>
                <td>
                  <EmailDetails
                    email={row.user?.email ?? row.email}
                    name={row.englishName}
                    verifiedAt={row.user?.emailVerifiedAt}
                    userId={row.user?.id}
                    tutorId={row.id}
                    linked={!!row.user}
                    canSendSetup={
                      !readOnly && (!row.user || row.user.email === row.email)
                    }
                  />
                </td>
                <td>{row.gradeLevel ?? "—"}</td>
                <td>
                  <span
                    className={
                      row.status === "ACTIVE" ? "badge-green" : "badge-slate"
                    }
                  >
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="text-right whitespace-nowrap">
                  {!readOnly && (
                    <button
                      className="link"
                      onClick={() => setEditingId(row.id)}
                    >
                      {t("accountProfile.editProfile")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
