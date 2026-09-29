"use client";
import { invalidateTuteeViews } from "~/lib/tutee-cache";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";
import { pairingScheduleText } from "~/lib/pairing-schedule";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { TuteeEditor } from "~/app/_components/tutee-editor";
import { TuteeAcademicCell } from "~/app/_components/tutee-academic-cell";
import {
  HistoryError,
  TuteeHistoryDialog,
} from "~/app/_components/tutee-history";
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
          <Link href="/admin/discipline" className="hover:opacity-80">
            <span className="badge-red">{removalLabel}</span>
          </Link>
        ) : s.effectiveReds >= 1 ? (
          <Link href="/admin/discipline" className="hover:opacity-80">
            <span className="badge-amber">
              {s.validRed}🟥 {s.validYellow}🟨
            </span>
          </Link>
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
  const del = api.admin.deleteTutee.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");

  const all = tutees.data ?? [];
  const editing = all.find((row) => row.id === editingId);
  const pendingCount = all.filter((t) => t.status === "PENDING").length;
  const courseList = courses.data ?? [];

  const statusLabel = (s: Status) => t(`admin.tutees.status.${s}`);

  // Active + inactive tutees, sorted by the chosen column.
  const rows = useMemo(() => {
    // Pending profiles also need corrections before staff can assign them.
    const rest = (tutees.data ?? []).filter((row) => {
      const owner = row.owner ?? row.user;
      return (
        (historyView === "all" ||
          (historyView === "historical" ? row.historical : !row.historical)) &&
        (showUnverified || !owner || !!owner.emailVerifiedAt) &&
        [
          row.englishName,
          row.alternativeNames,
          owner?.username,
          owner?.email,
        ].some((value) =>
          value?.toLowerCase().includes(search.trim().toLowerCase()),
        )
      );
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return rest.sort((a, b) => {
      const sa = stats.data?.[a.id];
      const sb = stats.data?.[b.id];
      switch (sort.key) {
        case "grade":
          // Sort the grade shown in the row: historical evidence is independent
          // of the linked account's current academic profile.
          return (
            ((a.historical
              ? (normalizeGrade(a.gradeLevel).gradeLevel ?? 0)
              : (a.academic.gradeLevel ?? 0)) -
              (b.historical
                ? (normalizeGrade(b.gradeLevel).gradeLevel ?? 0)
                : (b.academic.gradeLevel ?? 0))) *
            dir
          );
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
  }, [
    tutees.data,
    stats.data,
    sort.key,
    sort.dir,
    historyView,
    showUnverified,
    search,
  ]);

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
        <h1 className="page-title">{t("admin.tutees.title")}</h1>
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
        <section className="card p-5">
          <h2 className="section-title">{t("admin.tutees.addTutee")}</h2>
          <ProfilePolicyHint />
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate(
                {
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
                    setName("");
                    setGradeLevel("");
                    setFirstChoiceId("");
                    setSecondChoiceId("");
                  },
                },
              );
            }}
          >
            <label className="space-y-1">
              <span className="label">{t("admin.tutees.fullName")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("admin.tutees.phName")}
                className="input field-auto min-w-48"
              />
            </label>
            <label className="space-y-1">
              <span className="label">{t("admin.tutees.grade")}</span>
              <OfferedGradeSelect
                value={gradeLevel}
                onChange={setGradeLevel}
                offeredGrades={policy.offeredGrades}
                includeGraduated
              />
            </label>
            <label className="space-y-1">
              <span className="label">{t("admin.tutees.firstChoice")}</span>
              <select
                value={firstChoiceId}
                onChange={(e) => setFirstChoiceId(e.target.value)}
                className="select field-auto min-w-40"
              >
                <option value="">—</option>
                {courseList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="label">{t("admin.tutees.secondChoice")}</span>
              <select
                value={secondChoiceId}
                onChange={(e) => setSecondChoiceId(e.target.value)}
                className="select field-auto min-w-40"
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
            <button
              className="btn-primary"
              disabled={!name.trim() || create.isPending}
            >
              {t("admin.tutees.addTuteeBtn")}
            </button>
          </form>
          {create.error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              <ProfilePolicyError message={create.error.message} />
            </p>
          )}
        </section>
      )}

      {/* Bottom table — toggled between the tutee list and the tutor/pairings view */}
      <div className="flex gap-2">
        <button
          className={
            view === "tutees" ? "btn-primary btn-sm" : "btn-secondary btn-sm"
          }
          onClick={() => setView("tutees")}
        >
          {t("admin.tutees.viewTutees")}
        </button>
        <button
          className={
            view === "tutors" ? "btn-primary btn-sm" : "btn-secondary btn-sm"
          }
          onClick={() => setView("tutors")}
        >
          {t("admin.tutees.viewTutors")}
        </button>
      </div>

      {view === "tutors" && (
        <PastTutorsToggle showPast={showPast} onChange={setShowPast} />
      )}
      {view === "tutors" && (
        <section className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("admin.tutees.colTutor")}</th>
                <th>{t("admin.tutees.colSubject")}</th>
                <th>{t("admin.tutees.colDayTime")}</th>
                <th>{t("admin.tutees.colTimeSlot")}</th>
                <th>{t("admin.tutees.colPairedTutees")}</th>
              </tr>
            </thead>
            <tbody>
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
                    </tr>,
                  ];
                }
                return tps.map((p, i) => (
                  <tr key={p.id}>
                    <td className="font-medium text-slate-800">
                      {i === 0 ? tutor.englishName : ""}
                    </td>
                    <td>{p.subject}</td>
                    <td className="text-slate-600">
                      {pairingScheduleText(p, t("scheduling.awaiting"))}
                    </td>
                    <td className="text-slate-600">
                      {p.timeSlot?.label ?? t("admin.tutees.tbd")}
                    </td>
                    <td className="text-slate-600">
                      {p.tutees.map((t) => t.tutee.englishName).join(", ") ||
                        "—"}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </section>
      )}

      {view === "tutees" && (
        <section className="space-y-3" aria-label={h("filterTitle")}>
          <div className="flex flex-wrap items-center gap-2">
            {(["current", "historical", "all"] as const).map((value) => (
              <button
                key={value}
                className={`${historyView === value ? "btn-primary" : "btn-secondary"} btn-sm min-h-11 lg:h-8 lg:min-h-8 lg:py-0`}
                aria-pressed={historyView === value}
                onClick={() => setHistoryView(value)}
              >
                {h(value)}
              </button>
            ))}
            <button
              className="btn-secondary btn-sm min-h-11 lg:h-8 lg:min-h-8 lg:py-0"
              disabled={tutees.isFetching}
              onClick={() => void invalidate()}
            >
              {h("refresh")}
            </button>
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
          {tutees.error && <HistoryError message={tutees.error.message} />}
          <p className="muted text-xs lg:hidden">{h("scrollHint")}</p>
        </section>
      )}
      {view === "tutees" && (
        <section className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader sort={sort} sortKey="name">
                  {t("admin.tutees.colName")}
                </SortHeader>
                <th>{t("admin.tutees.colContact")}</th>
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
                <th>{t("admin.users.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t2) => (
                <tr key={t2.id}>
                  <td className="max-w-52 min-w-40">
                    <p className="font-medium [overflow-wrap:anywhere] text-slate-900">
                      {t2.englishName}
                    </p>
                    {t2.alternativeNames && (
                      <p className="muted text-xs [overflow-wrap:anywhere]">
                        {t2.alternativeNames}
                      </p>
                    )}
                    {(t2.owner ?? t2.user)?.username && (
                      <p className="muted text-xs">
                        @{(t2.owner ?? t2.user)?.username}
                      </p>
                    )}
                  </td>
                  <td className="text-slate-600">
                    <EmailDetails
                      name={t2.englishName}
                      email={t2.owner?.email ?? t2.user?.email ?? t2.email}
                      verifiedAt={(t2.owner ?? t2.user)?.emailVerifiedAt}
                      userId={(t2.owner ?? t2.user)?.id}
                      canSendSetup={!readOnly && !!t2.user}
                      linked={!!(t2.owner ?? t2.user)}
                    />
                  </td>
                  <td className="min-w-40 text-slate-600">
                    <TuteeAcademicCell row={t2} />
                  </td>
                  <td className="w-36 max-w-36 whitespace-normal text-slate-600">
                    <ul className="space-y-1 text-sm">
                      {[t2.firstChoice, t2.secondChoice]
                        .filter((subject) => subject !== null)
                        .map((subject) => (
                          <li key={subject.id}>{subject.name}</li>
                        ))}
                    </ul>
                    {!t2.firstChoice && !t2.secondChoice && "—"}
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
                  {/* Shared account actions keep the same rhythm across management tables. */}
                  <td className="w-px text-right">
                    <div className="table-account-actions">
                      {!readOnly && (
                        <button
                          className="link table-account-action"
                          onClick={() => setDetailsId(t2.id)}
                        >
                          {h("details")}
                        </button>
                      )}
                      {!readOnly && (
                        <button
                          className="link table-account-action"
                          onClick={() => setEditingId(t2.id)}
                        >
                          {t("accountProfile.editProfile")}
                        </button>
                      )}
                      {!readOnly && (
                        <button
                          className="link-danger table-account-action"
                          onClick={() => del.mutate({ id: t2.id })}
                        >
                          {t("admin.tutees.deleteBtn")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-slate-500">
                    {t("admin.tutees.emptyTutees")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
