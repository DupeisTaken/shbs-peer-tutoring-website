"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

type CourseRow = { courseId: string; taken: boolean; grade: string };

const emptyRow: CourseRow = { courseId: "", taken: false, grade: "" };

export function TutorSignupForm() {
  const options = api.application.options.useQuery();
  const submit = api.application.submit.useMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<CourseRow[]>([{ ...emptyRow }]);

  const courses = options.data ?? [];

  const setRow = (i: number, patch: Partial<CourseRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => (rs.length < 3 ? [...rs, { ...emptyRow }] : rs));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const chosen = rows.map((r) => r.courseId).filter(Boolean);
  const canSubmit =
    name.trim() &&
    email.trim() &&
    chosen.length >= 1 &&
    new Set(chosen).size === chosen.length &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-900">Application received 🎉</h2>
        <p className="muted mt-2">
          Thanks, {name.trim()}. The coordinator team will review your application and arrange
          an interview. We&apos;ll reach you at {email.trim()}.
        </p>
      </div>
    );
  }

  return (
    <form
      className="card space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        submit.mutate({
          name: name.trim(),
          email: email.trim(),
          courses: rows
            .filter((r) => r.courseId)
            .map((r) => ({
              courseId: r.courseId,
              taken: r.taken,
              grade: r.taken ? r.grade.trim() || undefined : undefined,
            })),
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">Full name *</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="space-y-1">
          <span className="label">Contact email *</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
      </div>

      <div>
        <p className="label">Courses you want to tutor (up to 3) *</p>
        <p className="muted mb-2">
          For each, tell us whether you&apos;ve taken it and the grade or AP score you earned.
        </p>
        <div className="space-y-3">
          {rows.map((row, i) => {
            const usedElsewhere = rows
              .filter((_, idx) => idx !== i)
              .map((r) => r.courseId);
            return (
              <div
                key={i}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3"
              >
                <label className="space-y-1">
                  <span className="label">Course</span>
                  <select
                    className="select w-48"
                    value={row.courseId}
                    onChange={(e) => setRow(i, { courseId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {courses
                      .filter((c) => c.id === row.courseId || !usedElsewhere.includes(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.taken}
                    onChange={(e) => setRow(i, { taken: e.target.checked })}
                  />
                  I&apos;ve taken this
                </label>
                {row.taken && (
                  <label className="space-y-1">
                    <span className="label">Grade / AP score</span>
                    <input
                      className="input w-36"
                      value={row.grade}
                      onChange={(e) => setRow(i, { grade: e.target.value })}
                      placeholder="e.g. A / 5"
                    />
                  </label>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="link-danger pb-2 text-sm"
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {rows.length < 3 && (
          <button type="button" className="link mt-2 text-sm" onClick={addRow}>
            + Add another course
          </button>
        )}
      </div>

      {submit.error && (
        <p role="alert" className="text-sm text-red-600">
          {submit.error.message}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {submit.isPending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
