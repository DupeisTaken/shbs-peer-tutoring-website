"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";

type SlotLite = { id: string; label: string; dayOfWeek: number; startMin: number; endMin: number };

type PendingTutee = {
  id: string;
  englishName: string;
  gradeLevel: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  const t = useTranslations();
  const assign = api.admin.assignSignup.useMutation({
    onSuccess: () => onChanged(),
    onError: () => onChanged(), // refresh on a stale-write conflict
  });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: () => onChanged() });

  // Always show both choice positions; a position the tutee left blank renders grayed/disabled
  // so the request stays in the queue and the admin can still assign whatever was provided.
  const positions = [
    { key: "first", label: t("admin.requests.firstChoice"), course: tutee.firstChoice },
    { key: "second", label: t("admin.requests.secondChoice"), course: tutee.secondChoice },
  ];
  const [picks, setPicks] = useState<Record<string, string>>({});

  const activeTutors = tutors.filter((tu) => tu.active);
  const tutorLabel = (id: string) => {
    const tu = activeTutors.find((x) => x.id === id);
    const w = workload[id] ?? { pairings: 0, tutees: 0 };
    return t("admin.requests.tutorWorkload", {
      name: tu?.englishName ?? "?",
      pairings: w.pairings,
      tutees: w.tutees,
    });
  };

  const assignments = positions
    .filter((p) => p.course && picks[p.course.name])
    .map((p) => ({ subject: p.course!.name, tutorId: picks[p.course!.name]! }));

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900">
            <span className="badge-slate mr-2">#{order}</span>
            {tutee.englishName}
            {tutee.gradeLevel ? ` · ${t("admin.requests.grade", { grade: tutee.gradeLevel })}` : ""}
          </p>
          <p className="muted text-xs">
            {t("admin.requests.submitted", { when: new Date(tutee.createdAt).toLocaleString() })}
          </p>
          <p className="muted">
            {t("admin.requests.available", { list: availability(tutee.availabilities) })}
          </p>
          {tutee.preferredContact && (
            <p className="muted">{t("admin.requests.reach", { contact: tutee.preferredContact })}</p>
          )}
          <p className="muted">
            {tutee.signedRulebook
              ? t("admin.requests.signed", { name: tutee.signatureName ?? "" })
              : t("admin.requests.notSigned")}
          </p>
        </div>
        <button
          className="btn-danger btn-sm shrink-0"
          onClick={() => {
            if (confirm(t("admin.requests.declineConfirm", { name: tutee.englishName })))
              del.mutate({ id: tutee.id });
          }}
        >
          {t("admin.requests.decline")}
        </button>
      </div>

      {/* Assign each course choice to a tutor (workload shown in the dropdown). */}
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {positions.map((p) => {
          const filled = !!p.course;
          return (
            <div
              key={p.key}
              className={`flex flex-wrap items-center gap-2 ${filled ? "" : "opacity-50"}`}
            >
              <span className="w-44 text-sm text-slate-700">
                {p.label}:{" "}
                {filled ? (
                  <span className="font-medium">{p.course!.name}</span>
                ) : (
                  <span className="text-slate-400">{t("admin.requests.notProvided")}</span>
                )}
              </span>
              <select
                className="select w-72"
                disabled={!filled}
                value={filled ? (picks[p.course!.name] ?? "") : ""}
                onChange={(e) =>
                  filled && setPicks((prev) => ({ ...prev, [p.course!.name]: e.target.value }))
                }
              >
                <option value="">
                  {filled ? t("admin.requests.assignToTutor") : t("admin.requests.notProvided")}
                </option>
                {filled &&
                  activeTutors.map((tu) => (
                    <option key={tu.id} value={tu.id}>
                      {tutorLabel(tu.id)}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-1">
          <button
            className="btn-primary btn-sm"
            disabled={assignments.length === 0 || assign.isPending}
            onClick={() =>
              assign.mutate({
                tuteeId: tutee.id,
                termId,
                expectedUpdatedAt: tutee.updatedAt,
                assignments,
              })
            }
          >
            {assign.isPending ? t("admin.requests.assigning") : t("admin.requests.assignActivate")}
          </button>
          {assign.error && <span className="text-sm text-red-600">{assign.error.message}</span>}
          {(del.error ?? null) && <span className="text-sm text-red-600">{del.error?.message}</span>}
        </div>
      </div>
    </div>
  );
}

export default function RequestsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const terms = api.admin.terms.useQuery(undefined, { staleTime: REFERENCE_STALE_TIME });
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
        <h1 className="page-title">{t("admin.requests.title")}</h1>
        <p className="muted mt-1">{t("admin.requests.help")}</p>
      </div>

      {!activeTerm && <p className="text-sm text-red-600">{t("admin.requests.noTerm")}</p>}

      <div className="space-y-3">
        {activeTerm &&
          pending.map((t2, i) => (
            <RequestCard
              key={t2.id}
              tutee={t2}
              order={i + 1}
              tutors={tutors.data ?? []}
              workload={workload}
              termId={activeTerm.id}
              onChanged={invalidate}
            />
          ))}
        {pending.length === 0 && <p className="muted">{t("admin.requests.empty")}</p>}
      </div>
    </div>
  );
}
