"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";

type SlotLite = { id: string; label: string; dayOfWeek: number; startMin: number; endMin: number };

type PendingTutee = {
  id: string;
  englishName: string;
  gradeLevel: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  createdAt: Date;
  signedRulebook: boolean;
  signatureName: string | null;
  firstChoice: { id: string; name: string } | null;
  secondChoice: { id: string; name: string } | null;
  availabilities: { slot: SlotLite }[];
};

type Workload = Record<string, { pairings: number; tutees: number }>;

function availability(av: { slot: SlotLite }[]): string {
  if (av.length === 0) return "—";
  return av.map((a) => `${DAY_NAMES[a.slot.dayOfWeek]} ${minToHm(a.slot.startMin)}`).join(", ");
}

function RequestCard({
  tutee,
  order,
  tutors,
  workload,
  termId,
  onChanged,
}: {
  tutee: PendingTutee;
  order: number;
  tutors: { id: string; englishName: string; active: boolean }[];
  workload: Workload;
  termId: string;
  onChanged: () => Promise<unknown> | void;
}) {
  const assign = api.admin.assignSignup.useMutation({ onSuccess: () => onChanged() });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: () => onChanged() });

  // One tutor pick per offered course choice (keyed by subject name).
  const choices = [tutee.firstChoice, tutee.secondChoice].filter(
    (c): c is { id: string; name: string } => !!c,
  );
  const [picks, setPicks] = useState<Record<string, string>>({});

  const activeTutors = tutors.filter((t) => t.active);
  const tutorLabel = (id: string) => {
    const t = activeTutors.find((x) => x.id === id);
    const w = workload[id] ?? { pairings: 0, tutees: 0 };
    return `${t?.englishName ?? "?"} — ${w.pairings} pairings · ${w.tutees} tutees`;
  };

  const assignments = choices
    .filter((c) => picks[c.name])
    .map((c) => ({ subject: c.name, tutorId: picks[c.name]! }));

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900">
            <span className="badge-slate mr-2">#{order}</span>
            {tutee.englishName}
            {tutee.gradeLevel ? ` · Grade ${tutee.gradeLevel}` : ""}
          </p>
          <p className="muted text-xs">Submitted {new Date(tutee.createdAt).toLocaleString()}</p>
          <p className="muted">Available: {availability(tutee.availabilities)}</p>
          {tutee.preferredContact && <p className="muted">Reach: {tutee.preferredContact}</p>}
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

      {/* Assign each course choice to a tutor (workload shown in the dropdown). */}
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {choices.length === 0 && <p className="muted text-sm">No course choice on file.</p>}
        {choices.map((c, i) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2">
            <span className="w-44 text-sm text-slate-700">
              {i === 0 ? "1st choice" : "2nd choice"}: <span className="font-medium">{c.name}</span>
            </span>
            <select
              className="select w-72"
              value={picks[c.name] ?? ""}
              onChange={(e) => setPicks((p) => ({ ...p, [c.name]: e.target.value }))}
            >
              <option value="">— assign to tutor —</option>
              {activeTutors.map((t) => (
                <option key={t.id} value={t.id}>
                  {tutorLabel(t.id)}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <button
            className="btn-primary btn-sm"
            disabled={assignments.length === 0 || assign.isPending}
            onClick={() => assign.mutate({ tuteeId: tutee.id, termId, assignments })}
          >
            {assign.isPending ? "Assigning…" : "Assign & activate"}
          </button>
          {assign.error && <span className="text-sm text-red-600">{assign.error.message}</span>}
          {(del.error ?? null) && <span className="text-sm text-red-600">{del.error?.message}</span>}
        </div>
      </div>
    </div>
  );
}

export default function RequestsPage() {
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const terms = api.admin.terms.useQuery();
  const pairings = api.admin.pairings.useQuery();

  const invalidate = () =>
    Promise.all([utils.admin.tutees.invalidate(), utils.admin.pairings.invalidate()]);

  const activeTerm = (terms.data ?? []).find((t) => t.active) ?? terms.data?.[0];

  // Earliest first — processed with priority.
  const pending = useMemo(
    () =>
      (tutees.data ?? [])
        .filter((t) => t.status === "PENDING")
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [tutees.data],
  );

  const workload: Workload = useMemo(() => {
    const w: Workload = {};
    for (const p of pairings.data ?? []) {
      const cur = w[p.tutorId] ?? { pairings: 0, tutees: 0 };
      cur.pairings += 1;
      cur.tutees += p.tutees.length;
      w[p.tutorId] = cur;
    }
    return w;
  }, [pairings.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Signup requests (tutees)</h1>
        <p className="muted mt-1">
          Public tutee signups awaiting allocation, processed earliest-first. Assign each course
          choice to a tutor — that creates the pairing and the tutor then picks the time slot.
        </p>
      </div>

      {!activeTerm && (
        <p className="text-sm text-red-600">Create a term first so requests can be assigned.</p>
      )}

      <div className="space-y-3">
        {activeTerm &&
          pending.map((t, i) => (
            <RequestCard
              key={t.id}
              tutee={t}
              order={i + 1}
              tutors={tutors.data ?? []}
              workload={workload}
              termId={activeTerm.id}
              onChanged={invalidate}
            />
          ))}
        {pending.length === 0 && <p className="muted">No pending signups. 🎉</p>}
      </div>
    </div>
  );
}
