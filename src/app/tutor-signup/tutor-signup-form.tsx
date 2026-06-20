"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

type CourseRow = {
  courseId: string;
  taken: boolean;
  grade: string;
  hasApScore: boolean;
  apScore: string;
  selfStudied: boolean;
  selfStudyNote: string;
};

const emptyRow: CourseRow = {
  courseId: "",
  taken: false,
  grade: "",
  hasApScore: false,
  apScore: "",
  selfStudied: false,
  selfStudyNote: "",
};

const TAG_LABEL: Record<string, string> = {
  AP: "AP",
  HONORS: "Honors",
  STANDARD: "Standard",
};

export function TutorSignupForm() {
  const options = api.application.options.useQuery();
  const submit = api.application.submit.useMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
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
    preferredContact.trim() &&
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
          preferredContact: preferredContact.trim(),
          courses: rows
            .filter((r) => r.courseId)
            .map((r) => ({
              courseId: r.courseId,
              taken: r.taken,
              grade: r.taken ? r.grade.trim() || undefined : undefined,
              hasApScore: r.hasApScore,
              apScore: r.hasApScore ? r.apScore.trim() || undefined : undefined,
              selfStudied: r.selfStudied,
              selfStudyNote: r.selfStudied ? r.selfStudyNote.trim() || undefined : undefined,
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

      {/* Preferred contact — make it unmistakable how to reach this applicant. */}
      <label className="space-y-1">
        <span className="label">How can we reach you? *</span>
        <input
          className="input"
          value={preferredContact}
          onChange={(e) => setPreferredContact(e.target.value)}
          placeholder="e.g. text me at 555-123-4567, or email me (best after 4pm)"
          required
        />
        <span className="muted text-xs">
          The best way and time to reach you about your application and interview.
        </span>
      </label>

      <div>
        <p className="label">Courses you want to tutor (up to 3) *</p>
        <p className="muted mb-2">
          For each, tell us how you&apos;re qualified: whether you&apos;ve taken the class, hold
          an AP score (AP courses only), and/or self-studied it.
        </p>
        <div className="space-y-3">
          {rows.map((row, i) => {
            const usedElsewhere = rows
              .filter((_, idx) => idx !== i)
              .map((r) => r.courseId);
            const selected = courses.find((c) => c.id === row.courseId);
            const isAp = selected?.tag === "AP";
            return (
              <div
                key={i}
                className="space-y-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="label">Course</span>
                    <select
                      className="select w-48"
                      value={row.courseId}
                      onChange={(e) =>
                        // Reset the AP-score flag if the new course isn't AP.
                        setRow(i, { courseId: e.target.value, hasApScore: false, apScore: "" })
                      }
                    >
                      <option value="">Select…</option>
                      {courses
                        .filter((c) => c.id === row.courseId || !usedElsewhere.includes(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({TAG_LABEL[c.tag] ?? c.tag})
                          </option>
                        ))}
                    </select>
                  </label>
                  {selected && (
                    <span className="badge-slate mb-2">{TAG_LABEL[selected.tag] ?? selected.tag}</span>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="link-danger mb-2 ml-auto text-sm"
                      onClick={() => removeRow(i)}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Qualification paths */}
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.taken}
                      onChange={(e) => setRow(i, { taken: e.target.checked })}
                    />
                    I&apos;ve taken this class
                  </label>
                  {row.taken && (
                    <label className="space-y-1">
                      <span className="label">Grade earned</span>
                      <input
                        className="input w-32"
                        value={row.grade}
                        onChange={(e) => setRow(i, { grade: e.target.value })}
                        placeholder="e.g. A"
                      />
                    </label>
                  )}
                </div>

                {isAp && (
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={row.hasApScore}
                        onChange={(e) => setRow(i, { hasApScore: e.target.checked })}
                      />
                      I have an AP score
                    </label>
                    {/* AP score entry is only enabled once they say they have one. */}
                    <label className="space-y-1">
                      <span className="label">AP score</span>
                      <input
                        className="input w-32"
                        value={row.apScore}
                        disabled={!row.hasApScore}
                        onChange={(e) => setRow(i, { apScore: e.target.value })}
                        placeholder="1–5"
                      />
                    </label>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.selfStudied}
                      onChange={(e) => setRow(i, { selfStudied: e.target.checked })}
                    />
                    I self-studied this course
                  </label>
                  {row.selfStudied && (
                    <label className="block space-y-1">
                      <span className="label">How do you qualify / what have you achieved?</span>
                      <textarea
                        className="textarea w-full"
                        rows={2}
                        value={row.selfStudyNote}
                        onChange={(e) => setRow(i, { selfStudyNote: e.target.value })}
                        placeholder="e.g. completed an online course, competition results, portfolio…"
                      />
                    </label>
                  )}
                </div>
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
