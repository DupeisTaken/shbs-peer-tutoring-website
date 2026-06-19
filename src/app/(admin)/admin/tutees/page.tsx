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

function availabilitySummary(
  availabilities: { slot: SlotLite }[],
): string {
  if (availabilities.length === 0) return "—";
  return availabilities
    .map((a) => `${DAY_NAMES[a.slot.dayOfWeek]} ${minToHm(a.slot.startMin)}`)
    .join(", ");
}

export default function TuteesPage() {
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const courses = api.admin.courses.useQuery();

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
          Public signups arrive as <span className="badge-amber">pending</span>. Review,
          then approve and assign them to a tutor on the{" "}
          <a href="/admin/pairings" className="link">
            Pairings
          </a>{" "}
          page.
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
              <div
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-4"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-slate-900">
                    {t.englishName}
                    {t.gradeLevel ? ` · Grade ${t.gradeLevel}` : ""}
                  </p>
                  <p className="muted">
                    Courses: <span className="text-slate-700">{t.firstChoice?.name ?? "—"}</span>
                    {t.secondChoice ? ` / ${t.secondChoice.name}` : ""}
                  </p>
                  <p className="muted">Available: {availabilitySummary(t.availabilities)}</p>
                  <p className="muted">
                    {t.email ?? "no email"}
                    {t.phone ? ` · ${t.phone}` : ""}
                  </p>
                  <p className="muted">
                    Signed: {t.signedRulebook ? `✓ ${t.signatureName ?? ""}` : "— not signed"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => setStatus.mutate({ id: t.id, status: "ACTIVE" })}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => {
                      if (confirm(`Decline and delete ${t.englishName}'s request?`))
                        del.mutate({ id: t.id });
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
          {del.error && <p className="mt-2 text-sm text-red-600">{del.error.message}</p>}
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
