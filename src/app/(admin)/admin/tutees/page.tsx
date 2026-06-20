"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";

const STATUSES = ["PENDING", "ACTIVE", "INACTIVE"] as const;
type Status = (typeof STATUSES)[number];

function StatusBadge({ status }: { status: Status }) {
  const cls =
    status === "ACTIVE"
      ? "badge-green"
      : status === "PENDING"
        ? "badge-amber"
        : "badge-slate";
  return <span className={cls}>{status.toLowerCase()}</span>;
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
function StatsCells({ s }: { s?: TuteeStat }) {
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
          <span className="badge-red">removal</span>
        ) : (
          <span className={s.effectiveReds >= 1 ? "badge-amber" : "muted text-xs"}>
            {s.validRed}🟥 {s.validYellow}🟨
          </span>
        )}
      </td>
    </>
  );
}

type SlotLite = { id: string; label: string; dayOfWeek: number; startMin: number; endMin: number };

function availabilitySummary(availabilities: { slot: SlotLite }[]): string {
  if (availabilities.length === 0) return "—";
  return availabilities
    .map((a) => `${DAY_NAMES[a.slot.dayOfWeek]} ${minToHm(a.slot.startMin)}`)
    .join(", ");
}

type PendingTuteeData = {
  id: string;
  englishName: string;
  gradeLevel: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  signedRulebook: boolean;
  signatureName: string | null;
  createdAt: Date;
  firstChoice: { name: string } | null;
  secondChoice: { name: string } | null;
  availabilities: { slot: SlotLite }[];
};

/** A pending signup with inline approve / assign-to-tutor / decline controls. */
function PendingTutee({
  tutee,
  order,
  tutors,
  terms,
  onChanged,
}: {
  tutee: PendingTuteeData;
  order: number;
  tutors: { id: string; englishName: string; active: boolean }[];
  terms: { id: string; name: string; active: boolean }[];
  onChanged: () => Promise<unknown> | void;
}) {
  const activeTerm = terms.find((t) => t.active) ?? terms[0];
  const [tutorId, setTutorId] = useState("");
  const [termId, setTermId] = useState(activeTerm?.id ?? "");

  const assign = api.admin.assignTuteeToTutor.useMutation({ onSuccess: () => onChanged() });
  const setStatus = api.admin.setTuteeStatus.useMutation({ onSuccess: () => onChanged() });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: () => onChanged() });

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900">
            <span className="badge-slate mr-2">#{order}</span>
            {tutee.englishName}
            {tutee.gradeLevel ? ` · Grade ${tutee.gradeLevel}` : ""}
          </p>
          <p className="muted text-xs">
            Submitted {new Date(tutee.createdAt).toLocaleString()}
          </p>
          <p className="muted">
            Courses: <span className="text-slate-700">{tutee.firstChoice?.name ?? "—"}</span>
            {tutee.secondChoice ? ` / ${tutee.secondChoice.name}` : ""}
          </p>
          <p className="muted">Available: {availabilitySummary(tutee.availabilities)}</p>
          <p className="muted">
            {tutee.email ?? "no email"}
            {tutee.phone ? ` · ${tutee.phone}` : ""}
          </p>
          {tutee.preferredContact && (
            <p className="muted">Reach: {tutee.preferredContact}</p>
          )}
          <p className="muted">
            Signed: {tutee.signedRulebook ? `✓ ${tutee.signatureName ?? ""}` : "— not signed"}
          </p>
        </div>
        <button
          className="btn-danger btn-sm shrink-0"
          onClick={() => {
            if (confirm(`Decline and delete ${tutee.englishName}'s request?`))
              del.mutate({ id: tutee.id });
          }}
        >
          Decline
        </button>
      </div>

      {/* Assign to a tutor (creates the pairing; the tutor then picks the time slot). */}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="space-y-1">
          <span className="label">Assign to tutor</span>
          <select
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
            className="select w-48"
          >
            <option value="">Select tutor…</option>
            {tutors
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.englishName}
                </option>
              ))}
          </select>
        </label>
        {terms.length > 1 && (
          <label className="space-y-1">
            <span className="label">Term</span>
            <select
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="select w-40"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn-primary btn-sm"
          disabled={!tutorId || !termId || assign.isPending}
          onClick={() => assign.mutate({ tuteeId: tutee.id, tutorId, termId })}
        >
          {assign.isPending ? "Assigning…" : "Assign & activate"}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => setStatus.mutate({ id: tutee.id, status: "ACTIVE" })}
        >
          Approve only
        </button>
      </div>
      {(assign.error ?? del.error) && (
        <p className="mt-2 text-sm text-red-600">{(assign.error ?? del.error)?.message}</p>
      )}
    </div>
  );
}

export default function TuteesPage() {
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const courses = api.admin.courses.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const terms = api.admin.terms.useQuery();
  const pairings = api.admin.pairings.useQuery();
  const stats = api.admin.tuteeStats.useQuery();
  const [view, setView] = useState<"tutees" | "tutors">("tutees");

  const invalidate = () => utils.admin.tutees.invalidate();
  const create = api.admin.createTutee.useMutation({ onSuccess: invalidate });
  const update = api.admin.updateTutee.useMutation({ onSuccess: invalidate });
  const setStatus = api.admin.setTuteeStatus.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");

  const all = tutees.data ?? [];
  // Earliest submissions first — they're processed with priority.
  const pending = all
    .filter((t) => t.status === "PENDING")
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const rest = all.filter((t) => t.status !== "PENDING");
  const courseList = courses.data ?? [];

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
        <h1 className="page-title">Tutees</h1>
        <p className="muted mt-1">
          Public signups arrive as <span className="badge-amber">pending</span>, processed
          earliest-first. Assign each to a tutor here — that creates the pairing and the tutor
          picks the time slot from their own dashboard.
        </p>
      </div>

      {/* Pending review (always visible) */}
      {pending.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">
            Pending signups <span className="badge-amber ml-1">{pending.length}</span>
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((t, i) => (
              <PendingTutee
                key={t.id}
                tutee={t}
                order={i + 1}
                tutors={tutors.data ?? []}
                terms={terms.data ?? []}
                onChanged={invalidate}
              />
            ))}
          </div>
        </section>
      )}

      {/* Manual add (always visible) */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">Add a tutee</h2>
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
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </label>
          <label className="space-y-1">
            <span className="label">Grade</span>
            <input
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              className="input w-20"
            />
          </label>
          <label className="space-y-1">
            <span className="label">First choice</span>
            <select
              value={firstChoiceId}
              onChange={(e) => setFirstChoiceId(e.target.value)}
              className="select"
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
            <span className="label">Second choice</span>
            <select
              value={secondChoiceId}
              onChange={(e) => setSecondChoiceId(e.target.value)}
              className="select"
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
          <button className="btn-primary">Add</button>
        </form>
      </section>

      {/* Bottom table — toggled between the tutee list and the tutor/pairings view */}
      <div className="flex gap-2">
        <button
          className={view === "tutees" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          onClick={() => setView("tutees")}
        >
          Tutees
        </button>
        <button
          className={view === "tutors" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          onClick={() => setView("tutors")}
        >
          Tutors &amp; pairings
        </button>
      </div>

      {view === "tutors" && (
        <section className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tutor</th>
                <th>Subject</th>
                <th>Day / time</th>
                <th>Time slot</th>
                <th>Paired tutees</th>
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
                        no pairings
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
                    <td className="text-slate-600">{p.timeSlot?.label ?? "TBD"}</td>
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

      {/* All tutees */}
      {view === "tutees" && (
      <section className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Grade</th>
              <th>Courses</th>
              <th>Sessions</th>
              <th>Discipline</th>
              <th>Contact</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rest.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    defaultValue={t.englishName}
                    className="input max-w-[10rem]"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.englishName)
                        update.mutate({
                          id: t.id,
                          englishName: v,
                          gradeLevel: t.gradeLevel,
                          email: t.email,
                          phone: t.phone,
                          notes: t.notes,
                          status: t.status,
                          firstChoiceId: t.firstChoiceId,
                          secondChoiceId: t.secondChoiceId,
                        });
                    }}
                  />
                </td>
                <td>{t.gradeLevel ?? "—"}</td>
                <td className="text-slate-600">
                  {t.firstChoice?.name ?? "—"}
                  {t.secondChoice ? ` / ${t.secondChoice.name}` : ""}
                </td>
                <StatsCells s={stats.data?.[t.id]} />
                <td className="text-slate-600">
                  {t.preferredContact ?? t.email ?? t.phone ?? "—"}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={t.status} />
                    <select
                      value={t.status}
                      onChange={(e) =>
                        setStatus.mutate({ id: t.id, status: e.target.value as Status })
                      }
                      className="select w-28"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="text-right">
                  <button className="link-danger" onClick={() => del.mutate({ id: t.id })}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rest.length === 0 && (
              <tr>
                <td colSpan={8} className="text-slate-500">
                  No active tutees yet.
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
