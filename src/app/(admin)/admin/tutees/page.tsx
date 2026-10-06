"use client";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { nameDraft, fullPersonName } from "~/lib/person-name";
import { matchesPersonSearch } from "~/lib/person-search";

import { invalidateTuteeViews } from "~/lib/tutee-cache";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";
import { pairingScheduleText } from "~/lib/pairing-schedule";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  useProfilePolicy,
  ProfilePolicyHint,
  ProfilePolicyError,
  OfferedGradeSelect,
} from "~/app/_components/profile-policy";
import { api } from "~/trpc/react";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useReadOnly } from "~/app/_components/read-only";
import { EmailDetails } from "~/app/_components/email-details";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { StatePanel } from "~/app/_components/ui/patterns";
import { TuteeEditor } from "~/app/_components/tutee-editor";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { TuteeAcademicCell } from "~/app/_components/tutee-academic-cell";
import { TuteeHistoryDialog } from "~/app/_components/tutee-history";
import { type TuteeHistoryView } from "~/lib/tutee-history";
import { GRADUATED_GRADE, normalizeGrade } from "~/lib/academics";

type Status = "PENDING" | "ACTIVE" | "INACTIVE";

function StatusBadge({ status, label }: { status: Status; label: string }) {
  const cls =
    status === "ACTIVE"
      ? "badge-green"
      : status === "PENDING"
        ? "badge-amber"
        : "badge-slate";
  return <span className={cls}>{label}</span>;
}

type TuteeStat = {
  sessions: number;
  present: number;
  validYellow: number;
  validRed: number;
  effectiveReds: number;
  removalPending: boolean;
};

/** Two table cells: session attendance (present/total) and discipline standing. */
function StatsCells({
  s,
  removalLabel,
}: {
  s?: TuteeStat;
  removalLabel: string;
}) {
  if (!s) {
    return (
      <>
        <td className="text-slate-400">—</td>
        <td className="text-slate-400">—</td>
      </>
    );
  }
  return (
    <>
      <td className="text-slate-600">
        {s.present}/{s.sessions}
      </td>
      <td>
        {s.removalPending ? (
          <span className="badge-red">{removalLabel}</span>
        ) : s.effectiveReds >= 1 ? (
          <span className="badge-amber">
            {s.validRed}🟥 {s.validYellow}🟨
          </span>
        ) : (
          <span className="muted text-xs">
            {s.validRed}🟥 {s.validYellow}🟨
          </span>
        )}
      </td>
    </>
  );
}

export default function TuteesPage() {
  const t = useTranslations();
  const h = useTranslations("tuteeHistory");
  const [historyView, setHistoryView] = useState<TuteeHistoryView>("current");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showUnverified, setShowUnverified] = useState(false);
  const permissions = api.tuteeHistory.permissions.useQuery();
  const policy = useProfilePolicy();
  const readOnly = useReadOnly();
  const [creationOpen, setCreationOpen] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const restoreAddFocus = useRef(false);
  const creationSubmitting = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const courses = api.admin.subjects.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
  const pairings = api.admin.pairings.useQuery();
  const stats = api.admin.tuteeStats.useQuery();
  const [view, setView] = useState<"tutees" | "tutors">("tutees");
  const sort = useSort("name");

  const invalidate = () => invalidateTuteeViews(utils);
  const create = api.admin.createTutee.useMutation({ onSuccess: invalidate });
  const creationApprovalId = create.error?.data?.approvalId;
  const del = api.admin.deleteTutee.useMutation({ onSuccess: invalidate });
  useEffect(() => {
    // Mutation callbacks can run while the trigger is still disabled. Restore
    // focus only after React renders the closed form and enabled trigger.
    if (!creationOpen && !create.isPending && restoreAddFocus.current) {
      restoreAddFocus.current = false;
      addTrigger.current?.focus();
    }
  }, [creationOpen, create.isPending]);

  const [names, setNames] = useState(() => nameDraft());
  const name = fullPersonName(names);
  const [gradeLevel, setGradeLevel] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");

  const all = tutees.data ?? [];
  const rosterLoading = tutees.isPending || (!tutees.data && !tutees.error);
  const editing = all.find((row) => row.id === editingId);
  const pendingCount = all.filter((t) => t.status === "PENDING").length;
  const courseList = courses.data ?? [];

  const statusLabel = (s: Status) => t(`admin.tutees.status.${s}`);

  // Keep the visible roster scope separate from search so empty views and no
  // matches can explain different outcomes without bypassing visibility filters.
  const scopedRows = useMemo(
    () =>
      (tutees.data ?? []).filter((row) => {
        const owner = row.owner ?? row.user;
        return (
          (historyView === "all" ||
            (historyView === "historical"
              ? row.historical
              : !row.historical)) &&
          (showUnverified || !owner || !!owner.emailVerifiedAt)
        );
      }),
    [tutees.data, historyView, showUnverified],
  );

  const rows = useMemo(() => {
    const rest = scopedRows.filter((row) => {
      const owner = row.owner ?? row.user;
      return matchesPersonSearch(row, search, [owner?.username, owner?.email]);
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return rest.sort((a, b) => {
      const sa = stats.data?.[a.id];
      const sb = stats.data?.[b.id];
      switch (sort.key) {
        case "grade": {
          // Sort the grade shown in the row: historical evidence is independent
          // of the linked account's current academic profile.
          const aEnrollment = a.enrollmentCorrection ?? a.enrollmentOriginal;
          const bEnrollment = b.enrollmentCorrection ?? b.enrollmentOriginal;
          return (
            ((a.historical || !(a.owner ?? a.user)
              ? (normalizeGrade(aEnrollment ? aEnrollment.rawGrade : a.gradeLevel).gradeLevel ?? 0)
              : (a.academic.gradeLevel ?? 0)) -
              (b.historical || !(b.owner ?? b.user)
                ? (normalizeGrade(bEnrollment ? bEnrollment.rawGrade : b.gradeLevel).gradeLevel ?? 0)
                : (b.academic.gradeLevel ?? 0))) *
            dir
          );
        }
        case "sessions":
          return ((sa?.sessions ?? 0) - (sb?.sessions ?? 0)) * dir;
        case "discipline":
          return ((sa?.effectiveReds ?? 0) - (sb?.effectiveReds ?? 0)) * dir;
        case "status":
          return compare(a.status, b.status) * dir;
        case "name":
        default:
          return compare(a.englishName, b.englishName) * dir;
      }
    });
  }, [scopedRows, stats.data, sort.key, sort.dir, search]);

  // Group pairings by tutor for the tutor-centric view.
  const pairingsByTutor = new Map<string, typeof pairings.data>();
  for (const p of pairings.data ?? []) {
    const arr = pairingsByTutor.get(p.tutorId) ?? [];
    arr.push(p);
    pairingsByTutor.set(p.tutorId, arr);
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title">{t("admin.tutees.title")}</h1>
          {!readOnly && (
            <button
              ref={addTrigger}
              type="button"
              className="btn-primary min-h-11 lg:min-h-10"
              aria-expanded={creationOpen}
              aria-controls="add-tutee-form"
              disabled={create.isPending}
              onClick={() => {
                if (create.isPending || creationSubmitting.current) return;
                // A completed save belongs to that draft only. Preserve failed
                // drafts and their errors when hiding/reopening the form.
                if (!creationOpen && create.isSuccess) create.reset();
                setCreationOpen((open) => !open);
              }}
            >
              {t(
                creationOpen
                  ? "admin.tutees.hideAddForm"
                  : "admin.tutees.addTutee",
              )}
            </button>
          )}
        </div>
        <p className="muted mt-1">
          {t("admin.tutees.help")}{" "}
          <Link href="/admin/requests" className="link">
            {t("admin.tutees.signupRequests")}
          </Link>
          {pendingCount > 0 && (
            <span className="badge-amber ml-1">
              {t("admin.tutees.pendingBadge", { count: pendingCount })}
            </span>
          )}
          .
        </p>
      </div>

      {detailsId && (
        <TuteeHistoryDialog
          tuteeId={detailsId}
          onClose={() => setDetailsId(null)}
        />
      )}
      {/* Manual add */}
      {!readOnly && editing && (
        <TuteeEditor
          key={editing.id}
          row={editing}
          historyPermissions={permissions.data}
          onClose={() => setEditingId(null)}
        />
      )}
      {!readOnly && (
        // Keep the form mounted when hidden: names, choices and validation stay
        // intact until a successful save or navigation away from this page.
        <section
          id="add-tutee-form"
          hidden={!creationOpen}
          aria-labelledby="add-tutee-title"
          className="card p-5"
        >
          <h2 id="add-tutee-title" className="section-title">
            {t("admin.tutees.addTutee")}
          </h2>
          <p className="muted mt-1 text-sm">{t("admin.tutees.addDraftHelp")}</p>
          <ProfilePolicyHint />
          <form
            className="mt-3"
            aria-busy={create.isPending}
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !name.trim() ||
                create.isPending ||
                creationSubmitting.current
              )
                return;
              // Block a second submit before the pending render disables the
              // form, so only one request owns this draft until it settles.
              creationSubmitting.current = true;
              create.mutate(
                {
                  ...names,
                  englishName: name.trim(),
                  gradeLevel:
                    gradeLevel && gradeLevel !== GRADUATED_GRADE
                      ? gradeLevel
                      : undefined,
                  academicallyGraduated: gradeLevel === GRADUATED_GRADE,
                  firstChoiceId: firstChoiceId || undefined,
                  secondChoiceId: secondChoiceId || undefined,
                  status: "ACTIVE",
                },
                {
                  onSuccess: () => {
                    setNames(nameDraft());
                    setGradeLevel("");
                    setFirstChoiceId("");
                    setSecondChoiceId("");
                    restoreAddFocus.current = true;
                    setCreationOpen(false);
                  },
                  onSettled: () => {
                    creationSubmitting.current = false;
                  },
                },
              );
            }}
          >
            {/* Freeze every draft field while the submitted snapshot is saved. */}
            <fieldset
              disabled={create.isPending}
              className="grid max-w-2xl min-w-0 gap-4 [&_.input:disabled]:bg-slate-50 [&_.select:disabled]:bg-slate-50"
            >
              <PersonNameFields value={names} onChange={setNames} />
              {/* Keep choices in their own aligned row; wrapping the whole name
                  block beside Grade made the final name row look misaligned. */}
              <div className="grid min-w-0 items-end gap-3 sm:grid-cols-3">
                <label className="min-w-0 space-y-1">
                  <span className="label">
                    {t("admin.tutees.grade")}
                    <FieldRequirement state="optional" />
                  </span>
                  <OfferedGradeSelect
                    value={gradeLevel}
                    onChange={setGradeLevel}
                    offeredGrades={policy.offeredGrades}
                    includeGraduated
                  />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="label">
                    {t("admin.tutees.firstChoice")}
                    <FieldRequirement state="optional" />
                  </span>
                  <select
                    value={firstChoiceId}
                    onChange={(e) => setFirstChoiceId(e.target.value)}
                    className="select min-h-11 w-full lg:min-h-10"
                  >
                    <option value="">—</option>
                    {courseList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="label">
                    {t("admin.tutees.secondChoice")}
                    <FieldRequirement state="optional" />
                  </span>
                  <select
                    value={secondChoiceId}
                    onChange={(e) => setSecondChoiceId(e.target.value)}
                    className="select min-h-11 w-full lg:min-h-10"
                  >
                    <option value="">—</option>
                    {courseList
                      .filter((c) => c.id !== firstChoiceId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn-primary min-h-11 lg:min-h-10"
                  disabled={!name.trim() || create.isPending}
                >
                  {t("admin.tutees.addTuteeBtn")}
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-11 lg:min-h-10"
                  disabled={create.isPending}
                  onClick={() => {
                    if (create.isPending || creationSubmitting.current) return;
                    setCreationOpen(false);
                    addTrigger.current?.focus();
                  }}
                >
                  {t("admin.tutees.hideAddForm")}
                </button>
              </div>
            </fieldset>
          </form>
          {create.error && (
            <p
              role={creationApprovalId ? "status" : "alert"}
              className={`mt-3 text-sm ${creationApprovalId ? "text-emerald-700" : "text-red-600"}`}
            >
              {/* Queued approval is an expected outcome, not a failed save. */}
              {creationApprovalId ? (
                t("approvals.queuedBody")
              ) : (
                <ProfilePolicyError message={create.error.message} />
              )}
            </p>
          )}
        </section>
      )}

      {!readOnly && create.isSuccess && !creationOpen && (
        <p role="status" className="text-sm text-green-800">
          {t("admin.tutees.addSaved")}
        </p>
      )}

      {/* Bottom table — toggled between the tutee list and the tutor/pairings view */}
      <SectionTabs
        label={t("admin.tutees.title")}
        value={view}
        onChange={setView}
        items={[
          { value: "tutees", label: t("admin.tutees.viewTutees") },
          { value: "tutors", label: t("admin.tutees.viewTutors") },
        ]}
      >
        {view === "tutors" && (
          <PastTutorsToggle showPast={showPast} onChange={setShowPast} />
        )}
        {view === "tutors" &&
          (Boolean(tutors.error) || Boolean(pairings.error)) && (
            <StatePanel
              kind="error"
              title={t("uiPatterns.loadFailed")}
              action={
                <Button
                  size="compact"
                  disabled={tutors.isFetching || pairings.isFetching}
                  onClick={() =>
                    void Promise.all([tutors.refetch(), pairings.refetch()])
                  }
                >
                  {t("uiPatterns.retry")}
                </Button>
              }
            />
          )}
        {view === "tutors" && (
          <section className="card">
            <SummaryTable label={t("admin.tutees.viewTutors")}>
              <thead>
                <tr>
                  <th>{t("admin.tutees.colTutor")}</th>
                  <th>{t("admin.tutees.colSubject")}</th>
                  <th>{t("admin.tutees.colDayTime")}</th>
                  <th>{t("admin.tutees.colTimeSlot")}</th>
                  <th>{t("admin.tutees.colPairedTutees")}</th>
                  <th className="table-actions-heading">
                    {t("tablePatterns.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(!tutors.data || !pairings.data) &&
                  !tutors.error &&
                  !pairings.error && (
                    <tr>
                      <td colSpan={6}>
                        <StatePanel
                          kind="loading"
                          title={t("common.loading")}
                        />
                      </td>
                    </tr>
                  )}
                {tutors.data &&
                  pairings.data &&
                  visibleTutors(tutors.data, showPast, [
                    ...pairingsByTutor.keys(),
                  ]).length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <StatePanel
                          kind="empty"
                          title={t("tablePatterns.records", { count: 0 })}
                        />
                      </td>
                    </tr>
                  )}
                {visibleTutors(tutors.data ?? [], showPast, [
                  ...pairingsByTutor.keys(),
                ]).flatMap((tutor) => {
                  const tps = pairingsByTutor.get(tutor.id) ?? [];
                  if (tps.length === 0) {
                    return [
                      <tr key={tutor.id}>
                        <td className="font-medium text-slate-800">
                          {tutor.englishName}
                        </td>
                        <td colSpan={4} className="text-slate-400">
                          {t("admin.tutees.noPairings")}
                        </td>
                        <TableActions>
                          <span className="text-slate-400">—</span>
                        </TableActions>
                      </tr>,
                    ];
                  }
                  return tps.map((p, i) => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-800">
                        {i === 0 ? tutor.englishName : ""}
                      </td>
                      <td>
                        <span className="block max-w-52 truncate">
                          {p.subject}
                        </span>
                      </td>
                      <td className="text-slate-600">
                        {pairingScheduleText(p, t("scheduling.awaiting"))}
                      </td>
                      <td className="text-slate-600">
                        <span className="block max-w-40 truncate">
                          {p.timeSlot?.label ?? t("admin.tutees.tbd")}
                        </span>
                      </td>
                      <td className="text-slate-600">{p.tutees.length}</td>
                      <TableActions>
                        {/* Rosters summarize the pairing; long subject and participant lists belong in details. */}
                        <TableDetails
                          title={`${tutor.englishName} · ${p.subject}`}
                        >
                          <dl className="space-y-3">
                            <div>
                              <dt className="muted">
                                {t("admin.tutees.colSubject")}
                              </dt>
                              <dd>{p.subject}</dd>
                            </div>
                            <div>
                              <dt className="muted">
                                {t("admin.tutees.colDayTime")}
                              </dt>
                              <dd>
                                {pairingScheduleText(
                                  p,
                                  t("scheduling.awaiting"),
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="muted">
                                {t("admin.tutees.colTimeSlot")}
                              </dt>
                              <dd>
                                {p.timeSlot?.label ?? t("admin.tutees.tbd")}
                              </dd>
                            </div>
                            <div>
                              <dt className="muted">
                                {t("admin.tutees.colPairedTutees")}
                              </dt>
                              <dd>
                                {p.tutees.length ? (
                                  <ul className="list-disc pl-5">
                                    {p.tutees.map(({ tutee }) => (
                                      <li key={tutee.id}>
                                        {tutee.englishName}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  "—"
                                )}
                              </dd>
                            </div>
                          </dl>
                        </TableDetails>
                      </TableActions>
                    </tr>
                  ));
                })}
              </tbody>
            </SummaryTable>
          </section>
        )}

        {view === "tutees" && (
          <section className="space-y-3" aria-label={h("filterTitle")}>
            <div className="flex flex-wrap items-center gap-2">
              {(["current", "historical", "all"] as const).map((value) => (
                <ChoiceButton
                  key={value}
                  selected={historyView === value}
                  onClick={() => setHistoryView(value)}
                >
                  {h(value)}
                </ChoiceButton>
              ))}
              <Button
                size="compact"
                disabled={tutees.isFetching}
                onClick={() => void invalidate()}
              >
                {h("refresh")}
              </Button>
            </div>
            <p className="muted text-sm">{h("historyHelp")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex-1">
                <span className="sr-only">{h("searchRecords")}</span>
                <input
                  className="input min-h-11 w-full lg:min-h-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={h("searchRecords")}
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showUnverified}
                  onChange={(e) => setShowUnverified(e.target.checked)}
                />
                {h("showUnverified")}
              </label>
            </div>
            <p className="muted text-xs" role="status">
              {tutees.isFetching
                ? h("loading")
                : h("visibleCount", {
                    count: rows.length,
                    total: all.length,
                  })}{" "}
              · {h("allPeriods")}
            </p>
            {tutees.error && (
              <StatePanel
                kind="error"
                title={
                  h.has(tutees.error.message)
                    ? h(tutees.error.message)
                    : h("failed")
                }
                action={
                  <Button
                    size="compact"
                    disabled={tutees.isFetching}
                    onClick={() => void tutees.refetch()}
                  >
                    {t("uiPatterns.retry")}
                  </Button>
                }
              />
            )}
            <p className="muted text-xs lg:hidden">{h("scrollHint")}</p>
          </section>
        )}
        {view === "tutees" && (
          <section className="card">
            <SummaryTable label={t("admin.tutees.viewTutees")}>
              <thead>
                <tr>
                  <SortHeader sort={sort} sortKey="name">
                    {t("admin.tutees.colName")}
                  </SortHeader>
                  <SortHeader sort={sort} sortKey="grade">
                    {h("gradeClass")}
                  </SortHeader>
                  <th>{t("admin.tutees.colCourses")}</th>
                  <SortHeader sort={sort} sortKey="sessions">
                    {t("admin.tutees.colSessions")}
                  </SortHeader>
                  <SortHeader sort={sort} sortKey="discipline">
                    {t("admin.tutees.colDiscipline")}
                  </SortHeader>
                  <SortHeader sort={sort} sortKey="status">
                    {t("admin.tutees.colStatus")}
                  </SortHeader>
                  <th className="table-actions-heading">
                    {t("tablePatterns.actions")}
                  </th>
                </tr>
              </thead>
              <tbody aria-busy={rosterLoading}>
                {rows.map((t2) => (
                  <tr key={t2.id}>
                    <td className="max-w-52 min-w-40">
                      <p className="font-medium [overflow-wrap:anywhere] text-slate-900">
                        {t2.englishName}
                      </p>
                      {/* The display name already applies the program's additional-name setting. */}
                      {(t2.owner ?? t2.user)?.username && (
                        <p className="muted text-xs">
                          @{(t2.owner ?? t2.user)?.username}
                        </p>
                      )}
                    </td>
                    <td className="min-w-40 text-slate-600">
                      <TuteeAcademicCell row={t2} />
                    </td>
                    <td className="text-slate-600">
                      {[t2.firstChoice, t2.secondChoice].filter(Boolean).length}
                    </td>
                    <StatsCells
                      s={stats.data?.[t2.id]}
                      removalLabel={t("admin.tutees.removalBadge")}
                    />
                    {/* Status is read-only here — transitions follow the procedures: assignment on
                      /admin/requests, removal & reinstatement on /admin/tutee-requests. */}
                    <td>
                      <StatusBadge
                        status={t2.status}
                        label={statusLabel(t2.status)}
                      />
                    </td>
                    <TableActions>
                      {/* Course details preserve the original public roster scope; history and contact remain separately authorized. */}
                      <TableDetails
                        title={`${t2.englishName} · ${t("admin.tutees.colCourses")}`}
                      >
                        <h3 className="font-semibold">
                          {t("admin.tutees.colCourses")}
                        </h3>
                        <ul className="space-y-1">
                          {[t2.firstChoice, t2.secondChoice]
                            .filter((subject) => subject !== null)
                            .map((subject) => (
                              <li key={subject.id}>{subject.name}</li>
                            ))}
                        </ul>
                        {!t2.firstChoice && !t2.secondChoice && <p>—</p>}
                      </TableDetails>
                      {!readOnly && (
                        <TableAction onClick={() => setDetailsId(t2.id)}>
                          {h("details")}
                        </TableAction>
                      )}
                      {!readOnly &&
                        (t2.owner?.email ?? t2.user?.email ?? t2.email) && (
                          <EmailDetails
                            name={t2.englishName}
                            email={
                              t2.owner?.email ?? t2.user?.email ?? t2.email
                            }
                            verifiedAt={(t2.owner ?? t2.user)?.emailVerifiedAt}
                            userId={(t2.owner ?? t2.user)?.id}
                            canSendSetup={!!t2.user}
                            linked={!!(t2.owner ?? t2.user)}
                          />
                        )}
                      {((stats.data?.[t2.id]?.removalPending ?? false) ||
                        (stats.data?.[t2.id]?.effectiveReds ?? 0) >= 1) && (
                        <Link
                          href="/admin/discipline"
                          className="table-action-link"
                        >
                          {t("admin.tutees.colDiscipline")}
                        </Link>
                      )}
                      {!readOnly && (
                        <TableAction onClick={() => setEditingId(t2.id)}>
                          {t("accountProfile.editProfile")}
                        </TableAction>
                      )}
                      {!readOnly && (
                        <TableAction
                          className="text-red-600"
                          disabled={del.isPending}
                          onClick={() => del.mutate({ id: t2.id })}
                        >
                          {t("admin.tutees.deleteBtn")}
                        </TableAction>
                      )}
                    </TableActions>
                  </tr>
                ))}
                {rosterLoading && (
                  <tr>
                    <td colSpan={7}>
                      <StatePanel kind="loading" title={h("loading")} />
                    </td>
                  </tr>
                )}
                {/* Failed reads, including refetches with an empty cache, do not prove the roster is empty. */}
                {tutees.data &&
                  !rosterLoading &&
                  !tutees.error &&
                  rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-slate-500">
                        {h(
                          scopedRows.length > 0 && search.trim()
                            ? "noSearchMatches"
                            : historyView === "historical"
                              ? "emptyHistory"
                              : historyView === "current"
                                ? "emptyCurrent"
                                : "emptyAll",
                        )}
                      </td>
                    </tr>
                  )}
              </tbody>
            </SummaryTable>
          </section>
        )}
      </SectionTabs>
    </div>
  );
}
