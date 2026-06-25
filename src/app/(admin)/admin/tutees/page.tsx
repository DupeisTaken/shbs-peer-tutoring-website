"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { SortHeader, useSort, compare } from "~/app/_components/sortable";

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
function StatsCells({ s, removalLabel }: { s?: TuteeStat; removalLabel: string }) {
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
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const courses = api.admin.subjects.useQuery(undefined, { staleTime: REFERENCE_STALE_TIME });
  const tutors = api.admin.tutors.useQuery();
  const pairings = api.admin.pairings.useQuery();
  const stats = api.admin.tuteeStats.useQuery();
  const [view, setView] = useState<"tutees" | "tutors">("tutees");
  const sort = useSort("name");

  const invalidate = () => utils.admin.tutees.invalidate();
  const create = api.admin.createTutee.useMutation({ onSuccess: invalidate });
  const update = api.admin.updateTutee.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");

  const all = tutees.data ?? [];
  const pendingCount = all.filter((t) => t.status === "PENDING").length;
  const courseList = courses.data ?? [];

  const statusLabel = (s: Status) => t(`admin.tutees.status.${s}`);

  // Active + inactive tutees, sorted by the chosen column.
  const rows = useMemo(() => {
    const rest = (tutees.data ?? []).filter((t) => t.status !== "PENDING");
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
          <button className="btn-primary" disabled={!name.trim() || create.isPending}>
            {t("admin.tutees.addTuteeBtn")}
          </button>
        </form>
      </section>

      {/* Bottom table — toggled between the tutee list and the tutor/pairings view */}
      <div className="flex gap-2">
        <button
          className={view === "tutees" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          onClick={() => setView("tutees")}
        >
          {t("admin.tutees.viewTutees")}
        </button>
        <button
          className={view === "tutors" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          onClick={() => setView("tutors")}
        >
          {t("admin.tutees.viewTutors")}
        </button>
      </div>

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
              {(tutors.data ?? []).flatMap((tutor) => {
                const tps = pairingsByTutor.get(tutor.id) ?? [];
                if (tps.length === 0) {
                  return [
                    <tr key={tutor.id}>
                      <td className="font-medium text-slate-800">{tutor.englishName}</td>
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
                      {DAY_NAMES[p.dayOfWeek]} {minToHm(p.startMin)}–{minToHm(p.endMin)}
                    </td>
                    <td className="text-slate-600">{p.timeSlot?.label ?? t("admin.tutees.tbd")}</td>
                    <td className="text-slate-600">
                      {p.tutees.map((t) => t.tutee.englishName).join(", ") || "—"}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </section>
      )}

      {view === "tutees" && (
        <section className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader sort={sort} sortKey="name">{t("admin.tutees.colName")}</SortHeader>
                <SortHeader sort={sort} sortKey="grade">{t("admin.tutees.colGrade")}</SortHeader>
                <th>{t("admin.tutees.colCourses")}</th>
                <SortHeader sort={sort} sortKey="sessions">{t("admin.tutees.colSessions")}</SortHeader>
                <SortHeader sort={sort} sortKey="discipline">{t("admin.tutees.colDiscipline")}</SortHeader>
                <th>{t("admin.tutees.colContact")}</th>
                <SortHeader sort={sort} sortKey="status">{t("admin.tutees.colStatus")}</SortHeader>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t2) => (
                <tr key={t2.id}>
                  <td>
                    <input
                      defaultValue={t2.englishName}
                      className="input field-auto min-w-40"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t2.englishName)
                          update.mutate({
                            id: t2.id,
                            englishName: v,
                            gradeLevel: t2.gradeLevel,
                            email: t2.email,
                            phone: t2.phone,
                            notes: t2.notes,
                            status: t2.status,
                            firstChoiceId: t2.firstChoiceId,
                            secondChoiceId: t2.secondChoiceId,
                          });
                      }}
                    />
                  </td>
                  <td>{t2.gradeLevel ?? "—"}</td>
                  <td className="text-slate-600">
                    {t2.firstChoice?.name ?? "—"}
                    {t2.secondChoice ? ` / ${t2.secondChoice.name}` : ""}
                  </td>
                  <StatsCells s={stats.data?.[t2.id]} removalLabel={t("admin.tutees.removalBadge")} />
                  <td className="text-slate-600">
                    {t2.preferredContact ?? t2.email ?? t2.phone ?? "—"}
                  </td>
                  {/* Status is read-only here — transitions follow the procedures: assignment on
                      /admin/requests, removal & reinstatement on /admin/tutee-requests. */}
                  <td>
                    <StatusBadge status={t2.status} label={statusLabel(t2.status)} />
                  </td>
                  <td className="text-right">
                    <button className="link-danger" onClick={() => del.mutate({ id: t2.id })}>
                      {t("admin.tutees.deleteBtn")}
                    </button>
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
