"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";

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
  assigned,
  fulfilled,
  onChanged,
  onFulfilled,
}: {
  tutee: PendingTutee;
  order: number;
  tutors: { id: string; englishName: string; active: boolean }[];
  workload: Workload;
  /** subject (course name) → tutor display name, for choices already assigned. */
  assigned: Map<string, string>;
  fulfilled: boolean;
  onChanged: () => Promise<unknown> | void;
  onFulfilled: (tuteeId: string) => void;
}) {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const assign = api.admin.assignSignup.useMutation({
    onSuccess: (data) => {
      if (data.fulfilled) onFulfilled(tutee.id);
      return onChanged();
    },
    onError: () => onChanged(), // refresh on a stale-write conflict
  });
  const del = api.admin.deleteTutee.useMutation({ onSuccess: () => onChanged() });

  // Collapse fulfilled requests by default; auto-collapse once a request becomes fulfilled.
  const [collapsed, setCollapsed] = useState(fulfilled);
  useEffect(() => {
    if (fulfilled) setCollapsed(true);
  }, [fulfilled]);

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

  return (
    <div
      className={`rounded-lg border border-slate-200 p-4 ${fulfilled ? "bg-slate-50 opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"
            aria-label={collapsed ? t("admin.requests.expand") : t("admin.requests.collapse")}
            onClick={() => setCollapsed((c) => !c)}
          >
            <DisclosureIcon open={!collapsed} />
          </button>
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-slate-900">
              <span className="badge-slate mr-2">#{order}</span>
              {tutee.englishName}
              {tutee.gradeLevel ? ` · ${t("admin.requests.grade", { grade: tutee.gradeLevel })}` : ""}
              {fulfilled && (
                <span className="badge-green ml-2">{t("admin.requests.fulfilled")}</span>
              )}
            </p>
            {!collapsed && (
              <>
                <p className="muted text-xs">
                  {t("admin.requests.submitted", { when: new Date(tutee.createdAt).toLocaleString() })}
                </p>
                <p className="muted">
                  {t("admin.requests.available", { list: availability(tutee.availabilities) })}
                </p>
                {tutee.preferredContact && (
                  <p className="muted">
                    {t("admin.requests.reach", { contact: tutee.preferredContact })}
                  </p>
                )}
                <p className="muted">
                  {tutee.signedRulebook
                    ? t("admin.requests.signed", { name: tutee.signatureName ?? "" })
                    : t("admin.requests.notSigned")}
                </p>
              </>
            )}
          </div>
        </div>
        {!fulfilled && !readOnly && (
          <button
            className="btn-danger btn-sm shrink-0"
            onClick={() => {
              if (confirm(t("admin.requests.declineConfirm", { name: tutee.englishName })))
                del.mutate({ id: tutee.id });
            }}
          >
            {t("admin.requests.decline")}
          </button>
        )}
      </div>

      {/* Assign each course choice to a tutor independently (workload shown in the dropdown). */}
      {!collapsed && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {positions.map((p) => {
            const filled = !!p.course;
            const assignedTo = filled ? assigned.get(p.course!.name) : undefined;
            const isAssigned = !!assignedTo;
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
                {isAssigned ? (
                  <span className="badge-green">
                    {t("admin.requests.assignedTo", { name: assignedTo })}
                  </span>
                ) : readOnly ? (
                  filled && <span className="muted text-sm">{t("admin.requests.assignToTutor")}</span>
                ) : (
                  <>
                    <select
                      className="select field-auto min-w-56"
                      disabled={!filled}
                      value={filled ? (picks[p.course!.name] ?? "") : ""}
                      onChange={(e) =>
                        filled &&
                        setPicks((prev) => ({ ...prev, [p.course!.name]: e.target.value }))
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
                    <button
                      className="btn-primary btn-sm"
                      disabled={!filled || !picks[p.course!.name] || assign.isPending}
                      onClick={() =>
                        assign.mutate({
                          tuteeId: tutee.id,
                          expectedUpdatedAt: tutee.updatedAt,
                          assignments: [
                            { subject: p.course!.name, tutorId: picks[p.course!.name]! },
                          ],
                        })
                      }
                    >
                      {assign.isPending ? t("admin.requests.assigning") : t("admin.requests.assign")}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {assign.error && <p className="text-sm text-red-600">{assign.error.message}</p>}
          {(del.error ?? null) && <p className="text-sm text-red-600">{del.error?.message}</p>}
        </div>
      )}
    </div>
  );
}

export default function RequestsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const currentPeriod = api.admin.currentPeriod.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const pairings = api.admin.pairings.useQuery();

  const invalidate = () =>
    Promise.all([utils.admin.tutees.invalidate(), utils.admin.pairings.invalidate()]);

  const hasPeriod = !!currentPeriod.data;

  // Requests fulfilled in this session stay visible (tagged + collapsed) instead of vanishing,
  // so the numbering of the remaining queue doesn't jump around mid-processing.
  const [retained, setRetained] = useState<Set<string>>(new Set());
  const onFulfilled = (id: string) => setRetained((prev) => new Set(prev).add(id));

  // subject already assigned per tutee → tutor display name (from existing pairings).
  const assignedByTutee = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const p of pairings.data ?? []) {
      for (const pt of p.tutees) {
        const inner = m.get(pt.tutee.id) ?? new Map<string, string>();
        inner.set(p.subject, p.tutor.englishName);
        m.set(pt.tutee.id, inner);
      }
    }
    return m;
  }, [pairings.data]);

  // Display = still-pending requests plus any retained-this-session (now ACTIVE) ones, earliest
  // first. Earliest-first keeps the priority order; retained items hold their original slot.
  const display = useMemo(
    () =>
      (tutees.data ?? [])
        .filter((t2) => t2.status === "PENDING" || retained.has(t2.id))
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [tutees.data, retained],
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

  const isFulfilled = (tutee: PendingTutee) => {
    const assigned = assignedByTutee.get(tutee.id) ?? new Map<string, string>();
    const provided = [tutee.firstChoice?.name, tutee.secondChoice?.name].filter(
      (n): n is string => !!n,
    );
    return provided.length > 0 && provided.every((c) => assigned.has(c));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.requests.title")}</h1>
        <p className="muted mt-1">{t("admin.requests.help")}</p>
      </div>

      {!hasPeriod && <p className="text-sm text-red-600">{t("admin.requests.noTerm")}</p>}

      <div className="space-y-3">
        {hasPeriod &&
          display.map((t2, i) => (
            <RequestCard
              key={t2.id}
              tutee={t2}
              order={i + 1}
              tutors={(tutors.data ?? []).map((tu) => ({
                id: tu.id,
                englishName: tu.englishName,
                active: tu.status === "ACTIVE",
              }))}
              workload={workload}
              assigned={assignedByTutee.get(t2.id) ?? new Map()}
              fulfilled={isFulfilled(t2)}
              onChanged={invalidate}
              onFulfilled={onFulfilled}
            />
          ))}
        {display.length === 0 && <p className="muted">{t("admin.requests.empty")}</p>}
      </div>
    </div>
  );
}
