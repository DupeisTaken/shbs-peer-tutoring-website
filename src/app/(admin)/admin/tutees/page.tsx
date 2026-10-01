"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";
import { useReadOnly } from "~/app/_components/read-only";
import { EmailDetails } from "~/app/_components/email-details";
import { TuteeEditor } from "~/app/_components/tutee-editor";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";

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
  const readOnly = useReadOnly();
  const [editingId, setEditingId] = useState<string | null>(null);
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const courses = api.admin.subjects.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const tutors = api.admin.tutors.useQuery();
  const pairings = api.admin.pairings.useQuery();
  const stats = api.admin.tuteeStats.useQuery();
  const [view, setView] = useState<"tutees" | "tutors">("tutees");
  const sort = useSort("name");

  const invalidate = () => utils.admin.tutees.invalidate();
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
    const rest = [...(tutees.data ?? [])];
    const dir = sort.dir === "asc" ? 1 : -1;
    return rest.sort((a, b) => {
      const sa = stats.data?.[a.id];
      const sb = stats.data?.[b.id];
      switch (sort.key) {
        case "grade":
          return compare(a.gradeLevel ?? "", b.gradeLevel ?? "") * dir;
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
  }, [tutees.data, stats.data, sort.key, sort.dir]);

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

      {/* Manual add */}
      {!readOnly && editing && (
        <TuteeEditor
          key={editing.id}
          row={editing}
          onClose={() => setEditingId(null)}
        />
      )}
      {!readOnly && (
        <section className="card p-5">
          <h2 className="section-title">{t("admin.tutees.addTutee")}</h2>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate(
                {
                  englishName: name.trim(),
                  gradeLevel: gradeLevel.trim() || undefined,
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
              <input
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                placeholder={t("admin.tutees.phGrade")}
                className="input field-auto min-w-20"
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
              {(tutors.data ?? []).flatMap((tutor) => {
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
                              {pairingScheduleText(p, t("scheduling.awaiting"))}
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
                                    <li key={tutee.id}>{tutee.englishName}</li>
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
        <section className="card">
          <SummaryTable label={t("admin.tutees.viewTutees")}>
            <thead>
              <tr>
                <SortHeader sort={sort} sortKey="name">
                  {t("admin.tutees.colName")}
                </SortHeader>
                <SortHeader sort={sort} sortKey="grade">
                  {t("admin.tutees.colGrade")}
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
            <tbody>
              {rows.map((t2) => (
                <tr key={t2.id}>
                  <td className="max-w-52 min-w-40">
                    <p className="font-medium [overflow-wrap:anywhere] text-slate-900">
                      {t2.englishName}
                    </p>
                    <p className="muted mt-1 text-xs">
                      {t2.user?.username
                        ? `@${t2.user.username}`
                        : t("accountProfile.setupRequired")}
                    </p>
                  </td>
                  <td>{t2.gradeLevel ?? "—"}</td>
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
                    <TableDetails title={t2.englishName}>
                      <dl className="space-y-3">
                        <div>
                          <dt className="muted">
                            {t("accountProfile.alternativeNames")}
                          </dt>
                          <dd>{t2.alternativeNames ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="muted">
                            {t("admin.tutees.colCourses")}
                          </dt>
                          <dd>
                            <ul>
                              {[t2.firstChoice, t2.secondChoice]
                                .filter((subject) => subject !== null)
                                .map((subject) => (
                                  <li key={subject.id}>{subject.name}</li>
                                ))}
                            </ul>
                            {!t2.firstChoice && !t2.secondChoice && "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="muted">
                            {t("admin.tutees.colContact")}
                          </dt>
                          <dd>
                            {readOnly
                              ? t("accountProfile.privateEmail")
                              : (t2.user?.email ??
                                t2.email ??
                                t("accountProfile.noEmail"))}
                          </dd>
                        </div>
                      </dl>
                    </TableDetails>
                    {!readOnly && (t2.user?.email ?? t2.email) && (
                      <EmailDetails
                        name={t2.englishName}
                        email={t2.user?.email ?? t2.email}
                        verifiedAt={t2.user?.emailVerifiedAt}
                        userId={t2.user?.id}
                        canSendSetup={!!t2.user}
                        linked={!!t2.user}
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
                        onClick={() => del.mutate({ id: t2.id })}
                      >
                        {t("admin.tutees.deleteBtn")}
                      </TableAction>
                    )}
                  </TableActions>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-slate-500">
                    {t("admin.tutees.emptyTutees")}
                  </td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
        </section>
      )}
    </div>
  );
}
