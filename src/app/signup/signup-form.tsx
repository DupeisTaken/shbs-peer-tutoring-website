"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { APP_TITLE } from "~/lib/branding";

export function SignupForm() {
  const options = api.tutee.signupOptions.useQuery();
  const submit = api.tutee.requestSignup.useMutation();

  const [englishName, setEnglishName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [signatureName, setSignatureName] = useState("");
  const [agreed, setAgreed] = useState(false);

  const courses = options.data?.courses ?? [];
  const slots = useMemo(() => options.data?.slots ?? [], [options.data]);

  // Group slots by day of week for a tidy availability picker.
  const slotsByDay = useMemo(() => {
    const map = new Map<number, typeof slots>();
    for (const s of slots) {
      const arr = map.get(s.dayOfWeek) ?? [];
      arr.push(s);
      map.set(s.dayOfWeek, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const toggleSlot = (id: string) =>
    setSlotIds((cur) =>
      cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id],
    );

  const canSubmit =
    englishName.trim() &&
    firstChoiceId &&
    slotIds.length > 0 &&
    signatureName.trim() &&
    agreed &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-900">Request received 🎉</h2>
        <p className="muted mt-2">
          Thanks, {englishName.trim()}. A coordinator will review your request and be in
          touch about your tutor and schedule.
        </p>
      </div>
    );
  }

  return (
    <form
      className="card space-y-6 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        submit.mutate({
          englishName: englishName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          gradeLevel: gradeLevel.trim() || undefined,
          firstChoiceId,
          secondChoiceId: secondChoiceId || undefined,
          slotIds,
          signatureName: signatureName.trim(),
          agreed: true,
        });
      }}
    >
      {/* Identity */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">Full name *</span>
          <input
            className="input"
            value={englishName}
            onChange={(e) => setEnglishName(e.target.value)}
            required
          />
        </label>
        <label className="space-y-1">
          <span className="label">Grade level</span>
          <input
            className="input"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            placeholder="e.g. 10"
          />
        </label>
        <label className="space-y-1">
          <span className="label">Email</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="label">Phone</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>

      {/* Course choices */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">Course — first choice *</span>
          <select
            className="select"
            value={firstChoiceId}
            onChange={(e) => setFirstChoiceId(e.target.value)}
            required
          >
            <option value="">Select a course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">Course — second choice (optional)</span>
          <select
            className="select"
            value={secondChoiceId}
            onChange={(e) => setSecondChoiceId(e.target.value)}
          >
            <option value="">— none —</option>
            {courses
              .filter((c) => c.id !== firstChoiceId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {/* Availability */}
      <fieldset>
        <legend className="label">Your available time slots *</legend>
        {slots.length === 0 ? (
          <p className="muted mt-1">No time slots are published yet. Please check back later.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {slotsByDay.map(([day, daySlots]) => (
              <div key={day}>
                <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  {DAY_NAMES[day]}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {daySlots.map((s) => {
                    const checked = slotIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition ${
                          checked
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleSlot(s.id)}
                        />
                        {s.label}{" "}
                        <span className="text-slate-400">
                          ({minToHm(s.startMin)}–{minToHm(s.endMin)})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {/* Rulebook signature */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span className="text-slate-700">
            I have read and agree to abide by the {APP_TITLE} rulebook.
          </span>
        </label>
        <label className="mt-3 block space-y-1">
          <span className="label">Electronic signature * (type your full name)</span>
          <input
            className="input"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Your full name"
            required
          />
        </label>
      </div>

      {submit.error && (
        <p role="alert" className="text-sm text-red-600">
          {submit.error.message}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {submit.isPending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
