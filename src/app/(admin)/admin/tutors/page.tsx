"use client";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { nameDraft } from "~/lib/person-name";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { EmailDetails } from "~/app/_components/email-details";
import { AcademicDetails } from "~/app/_components/academic-profile";
import { TutorProfileEditor } from "~/app/_components/tutor-profile-editor";
import { TutorDetailsButton } from "~/app/_components/tutor-details";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import {
  useProfilePolicy,
  ProfilePolicyHint,
  ProfilePolicyError,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableAction,
} from "~/app/_components/ui/summary-table";
import { GRADUATED_GRADE } from "~/lib/academics";
import { EnrollmentGrade } from "~/app/_components/tutee-history";
import { isPastTutor, visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";

export default function TutorsPage() {
  const t = useTranslations();
  const policy = useProfilePolicy();
  const readOnly = useReadOnly();
  const identity = api.account.me.useQuery();
  const canEditProfiles = !readOnly && !identity.error && ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  // Translate a tutor status outside the row map, where `t` is shadowed by the row variable.
  const statusLabel = (s: string) => t(`admin.tutorStatus.${s}`);
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
  const [names, setNames] = useState(() => nameDraft());
  const { firstName, lastName } = names;
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");
  // Draft values belong to the page, so dismissing the dialog does not discard them.
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const restoreCreateFocus = useRef(false);

  const sort = useSort("lastName");

  const invalidate = () => utils.admin.tutors.invalidate();
  const create = api.admin.createTutor.useMutation({
    onSuccess: async () => {
      setNames(nameDraft());
      setEmail("");
      setGrade("");
      setCreateOpen(false);
      setCreated(true);
      restoreCreateFocus.current = true;
      await invalidate();
    },
  });
  useEffect(() => {
    // Success can close the dialog while invalidation still keeps its trigger disabled.
    if (!createOpen && !create.isPending && restoreCreateFocus.current) {
      restoreCreateFocus.current = false;
      addTrigger.current?.focus();
    }
  }, [createOpen, create.isPending]);
  const closeCreate = () => {
    if (create.isPending) return;
    restoreCreateFocus.current = true;
    setCreateOpen(false);
  };
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.tutors.title")}</h1>
        {!readOnly && (
          <button
            ref={addTrigger}
            type="button"
            className="btn-primary min-h-11 lg:min-h-10"
            aria-haspopup="dialog"
            disabled={create.isPending}
            onClick={() => {
              setCreated(false);
              setCreateOpen(true);
            }}
          >
            {t("admin.tutors.addTutor")}
          </button>
        )}
      </div>
      <p
        role="status"
        className={created ? "text-sm text-green-700" : "sr-only"}
      >
        {created ? t("admin.tutors.created") : ""}
      </p>

      {!readOnly && createOpen && (
        <ProfileDialog
          title={t("admin.tutors.addTutor")}
          size="wide"
          pending={create.isPending}
          onClose={closeCreate}
        >
          <div className="mb-5 space-y-2">
            <p className="muted text-sm">{t("admin.tutors.createDraftHint")}</p>
            <p className="muted text-sm">{t("admin.tutors.help")}</p>
            <ProfilePolicyHint />
            <ProfilePolicyHint field="legal" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!create.isPending && firstName.trim() && lastName.trim())
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
            <fieldset
              disabled={create.isPending}
              className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            >
              <legend className="sr-only">{t("admin.tutors.addTutor")}</legend>
              <div className="min-w-0">
                <PersonNameFields
                  value={names}
                  onChange={setNames}
                  requireLastName
                />
              </div>
              {/* Single-line controls live inside labels, never as stretchable peers
              of the multirow name block. Labels can wrap without sizing inputs. */}
              <div className="flex min-w-0 flex-col gap-4">
                <label className="block min-w-0">
                  <span className="label">
                    {t("admin.tutors.colEmail")}
                    <FieldRequirement state="optional" />
                  </span>
                  <input
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    className="input min-h-11 w-full lg:min-h-10"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="label">
                    {t("admin.tutors.colGrade")}
                    <FieldRequirement state="optional" />
                  </span>
                  <OfferedGradeSelect
                    value={grade}
                    onChange={setGrade}
                    offeredGrades={policy.offeredGrades}
                    includeGraduated
                  />
                </label>
                <button
                  className="btn-primary min-h-11 self-start lg:min-h-10"
                  disabled={
                    !firstName.trim() || !lastName.trim() || create.isPending
                  }
                >
                  {t("admin.tutors.addTutor")}
                </button>
              </div>
            </fieldset>
            {create.error && (
              <p role="alert" className="mt-4 text-sm text-red-600">
                <ProfilePolicyError message={create.error.message} />
              </p>
            )}
          </form>
        </ProfileDialog>
      )}
      <p className="muted text-xs">{t("admin.tutors.accountMovedNote")}</p>
      <PastTutorsToggle showPast={showPast} onChange={setShowPast} />

      {editing && canEditProfiles && (
        <TutorProfileEditor
          key={editing.id}
          row={editing}
          canApply={identity.data?.role === "HEAD"}
          isHead={identity.data?.role === "HEAD"}
          onClose={() => setEditingId(null)}
        />
      )}
      {/* A failed refresh keeps cached rows available; only a cold load replaces the rows. */}
      {tutors.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={tutors.isFetching}
              onClick={() => void tutors.refetch()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      )}
      {tutors.data && tutors.isFetching && (
        <p role="status" className="muted text-sm">
          {t("common.loading")}
        </p>
      )}
      <div className="card">
        <SummaryTable label={t("admin.tutors.title")}>
          <thead>
            <tr>
              <SortHeader sort={sort} sortKey="firstName">
                {t("accountProfile.name")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="grade">
                {t("academics.title")}
              </SortHeader>
              <SortHeader sort={sort} sortKey="status">
                {t("admin.tutors.colStatus")}
              </SortHeader>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {!tutors.data && !tutors.error && (
              <tr>
                <td colSpan={4}>
                  <StatePanel kind="loading" title={t("common.loading")} />
                </td>
              </tr>
            )}
            {tutors.data && rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <StatePanel
                    kind="empty"
                    title={t("tablePatterns.records", { count: 0 })}
                  />
                </td>
              </tr>
            )}
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
                      {t("tuteeHistory.noAccount")}
                    </p>
                  )}
                </td>
                <td className="min-w-52">
                  {/* Keep the roster concise; full details retain the reference year. */}
                  {isPastTutor(row.status) ? (
                    <EnrollmentGrade
                      grade={row.gradeLevel?.toString()}
                      graduated={row.academicallyGraduated}
                    />
                  ) : (
                    <AcademicDetails
                      academic={row.academic}
                      showSchoolYear={false}
                      compact
                    />
                  )}
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
                <TableActions>
                  {/* Private details remain query-on-demand; viewers retain the public identity metadata. */}
                  {!readOnly && (
                    <TutorDetailsButton
                      tutorId={row.id}
                      name={row.englishName}
                    />
                  )}
                  {!readOnly && (row.user?.email ?? row.email) && (
                    <EmailDetails
                      email={row.user?.email ?? row.email}
                      name={row.englishName}
                      verifiedAt={row.user?.emailVerifiedAt}
                      userId={row.user?.id}
                      tutorId={row.id}
                      linked={!!row.user}
                      canSendSetup={!row.user || row.user.email === row.email}
                    />
                  )}
                  {canEditProfiles && (
                    <TableAction onClick={() => setEditingId(row.id)}>
                      {t("accountProfile.editProfile")}
                    </TableAction>
                  )}
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      </div>
    </div>
  );
}
