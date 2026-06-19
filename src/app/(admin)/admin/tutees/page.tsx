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
  signedRulebook: boolean;
  signatureName: string | null;
  firstChoice: { name: string } | null;
  secondChoice: { name: string } | null;
  availabilities: { slot: SlotLite }[];
};

/** A pending signup with inline approve / assign-to-tutor / decline controls. */
function PendingTutee({
  tutee,
  tutors,
  terms,
  onChanged,
}: {
  tutee: PendingTuteeData;
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
            {tutee.englishName}
            {tutee.gradeLevel ? ` · Grade ${tutee.gradeLevel}` : ""}
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
  const pending = all.filter((t) => t.status === "PENDING");
  const rest = all.filter((t) => t.status !== "PENDING");
  const courseList = courses.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Tutees</h1>
        <p className="muted mt-1">
          Public signups arrive as <span className="badge-amber">pending</span>. Assign each
          to a tutor here — that creates the pairing and the tutor picks the time slot from
          their own dashboard.
        </p>
      </div>

      {/* Pending review */}
      {pending.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">
            Pending signups <span className="badge-amber ml-1">{pending.length}</span>
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((t) => (
              <PendingTutee
                key={t.id}
                tutee={t}
                tutors={tutors.data ?? []}
                terms={terms.data ?? []}
                onChanged={invalidate}
              />
            ))}
          </div>
        </section>
      )}

      {/* Manual add */}
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

      {/* All tutees */}
      <section className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Grade</th>
              <th>Courses</th>
              <th>Availability</th>
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
                <td className="text-slate-600">{availabilitySummary(t.availabilities)}</td>
                <td className="text-slate-600">{t.email ?? t.phone ?? "—"}</td>
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
                <td colSpan={7} className="text-slate-500">
                  No active tutees yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
