"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { nameDraft } from "~/lib/person-name";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmailDetails } from "~/app/_components/email-details";
import { AcademicDetails } from "~/app/_components/academic-profile";
import { TutorProfileEditor } from "~/app/_components/tutor-profile-editor";
import { TutorDetailsButton } from "~/app/_components/tutor-details";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  ProfilePolicyError,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useReadOnly } from "~/app/_components/read-only";
import { GRADUATED_GRADE } from "~/lib/academics";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";

export default function TutorsPage() {
  const t = useTranslations();
  const policy = useProfilePolicy();
  const readOnly = useReadOnly();
  // Translate a tutor status outside the row map, where `t` is shadowed by the row variable.
  const statusLabel = (s: string) => t(`admin.tutorStatus.${s}`);
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
  const [names, setNames] = useState(() => nameDraft());
  const { firstName, lastName } = names;
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");

  const sort = useSort("lastName");

  const invalidate = () => utils.admin.tutors.invalidate();
  const create = api.admin.createTutor.useMutation({
    onSuccess: async () => {
      setNames(nameDraft());
      setEmail("");
      setGrade("");
      await invalidate();
    },
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = tutors.data?.find((row) => row.id === editingId);

  const rows = useMemo(() => {
    const data = visibleTutors(tutors.data ?? [], showPast);
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
          return (
            ((a.academic.gradeLevel ?? 0) - (b.academic.gradeLevel ?? 0)) * dir
          );
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
  }, [tutors.data, sort.key, sort.dir, showPast]);

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
                ...names,
                email: email.trim() || undefined,
                gradeLevel:
                  grade && grade !== GRADUATED_GRADE
                    ? Number(grade)
                    : undefined,
                academicallyGraduated: grade === GRADUATED_GRADE,
              });
          }}
        >
          <div className="w-full max-w-2xl">
            <PersonNameFields
              value={names}
              onChange={setNames}
              requireLastName
            />
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder={t("admin.tutors.phEmail")}
            className="input field-auto min-w-48"
          />
          <label className="min-w-32">
            <span className="sr-only">{t("admin.tutors.phGrade")}</span>
            <OfferedGradeSelect
              value={grade}
              onChange={setGrade}
              offeredGrades={policy.offeredGrades}
              includeGraduated
            />
          </label>
          <button
            className="btn-primary"
            disabled={!firstName.trim() || !lastName.trim() || create.isPending}
          >
            {t("admin.tutors.addTutor")}
          </button>
        </form>
      )}
      {!readOnly && (
        <>
          <ProfilePolicyHint />
          <ProfilePolicyHint field="legal" />
        </>
      )}
      {!readOnly && create.error && (
        <p role="alert" className="text-sm text-red-600">
          <ProfilePolicyError message={create.error.message} />
        </p>
      )}
      <p className="muted text-xs">{t("admin.tutors.accountMovedNote")}</p>
      <PastTutorsToggle showPast={showPast} onChange={setShowPast} />

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
                {t("academics.title")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="status">
                {t("admin.tutors.colStatus")}
              </SortHeader>
              {/* Anchor the absolute sr-only label inside the scrolling table. */}
              <th className="relative">
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
                <td className="min-w-52">
                  {/* Keep the roster concise; full details retain the reference year. */}
                  <AcademicDetails
                    academic={row.academic}
                    showSchoolYear={false}
                    compact
                  />
                </td>
                {/* Keep translated status badges readable inside the scrolling roster. */}
                <td className="whitespace-nowrap">
                  <span
                    className={
                      row.status === "ACTIVE" ? "badge-green" : "badge-slate"
                    }
                  >
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="min-w-40 text-right">
                  <div className="table-account-actions">
                    <TutorDetailsButton
                      tutorId={row.id}
                      name={row.englishName}
                    />
                    {!readOnly && (
                      <button
                        className="link table-account-action"
                        onClick={() => setEditingId(row.id)}
                      >
                        {t("accountProfile.editProfile")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
