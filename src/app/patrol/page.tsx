"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Headcount = "ZERO" | "ONE" | "TWO" | "THREE" | "FOUR_PLUS";
const BUCKETS: { value: Headcount; label: string }[] = [
  { value: "ZERO", label: "0" },
  { value: "ONE", label: "1" },
  { value: "TWO", label: "2" },
  { value: "THREE", label: "3" },
  { value: "FOUR_PLUS", label: "4+" },
];

/**
 * Crew patrol portal: walk the rooms (in the set patrol order), tap each room's student count, and
 * submit the sweep. One submitted patrol credits 0.5h. Only ACTIVE crew (or elevated admins) can
 * patrol; opted-out / paused members see a read-only notice and can request reentry.
 */
export default function PatrolPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const myStatus = api.crew.myStatus.useQuery();

  const status = myStatus.data?.status ?? null;
  const pending = myStatus.data?.pendingRequest ?? null;
  // ACTIVE crew patrol; elevated admins (no crewStatus) also reach here and may patrol.
  const canPatrol = status === "ACTIVE" || status === null;

  const config = api.crew.patrolConfig.useQuery(undefined, { enabled: canPatrol });
  const history = api.crew.myPatrols.useQuery(undefined, { enabled: canPatrol });

  // roomId -> chosen headcount + the time it was recorded.
  const [counts, setCounts] = useState<Record<string, { headcount: Headcount; at: string }>>({});
  const [note, setNote] = useState("");
  const [optOutReason, setOptOutReason] = useState("");
  const [showOptOut, setShowOptOut] = useState(false);

  const refetchStatus = () => utils.crew.myStatus.invalidate();
  const optOut = api.crew.requestOptOut.useMutation({ onSuccess: refetchStatus });
  const recall = api.crew.recallOptOut.useMutation({ onSuccess: refetchStatus });
  const reentry = api.crew.requestReentry.useMutation({ onSuccess: refetchStatus });

  const submit = api.crew.submitPatrol.useMutation({
    onSuccess: async () => {
      setCounts({});
      setNote("");
      await Promise.all([utils.crew.patrolConfig.invalidate(), utils.crew.myPatrols.invalidate()]);
    },
  });

  const pick = (roomId: string, headcount: Headcount) =>
    setCounts((c) => ({ ...c, [roomId]: { headcount, at: new Date().toISOString() } }));

  const rooms = config.data?.rooms ?? [];
  const recorded = Object.keys(counts).length;

  const onSubmit = () => {
    const observations = Object.entries(counts).map(([roomId, v]) => ({
      roomId,
      headcount: v.headcount,
      observedAt: new Date(v.at),
    }));
    if (observations.length === 0) return;
    const trimmed = note.trim();
    submit.mutate({ note: trimmed.length > 0 ? trimmed : undefined, observations });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{t("crew.patrol.title")}</h1>
          <p className="muted mt-1">{t("crew.patrol.subtitle")}</p>
        </div>
        <div className="card px-4 py-2 text-right">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t("crew.patrol.myHours")}
          </p>
          <p className="text-2xl font-bold text-slate-900">{(config.data?.myHours ?? 0).toFixed(1)} h</p>
          <p className="muted text-xs">
            {t("crew.patrol.patrolCount", { count: config.data?.myPatrols ?? 0 })}
          </p>
        </div>
      </div>

      {/* Opted-out / paused notice (no patrolling) */}
      {status === "OPTED_OUT" && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
          <p className="font-semibold">{t("crew.patrol.optedOut.title")}</p>
          <p className="mt-1 text-sm">{t("crew.patrol.optedOut.body")}</p>
          <div className="mt-3">
            {pending?.kind === "REENTRY" ? (
              <span className="text-sm">{t("crew.patrol.reentry.pending")}</span>
            ) : (
              <button className="btn-primary btn-sm" disabled={reentry.isPending} onClick={() => reentry.mutate()}>
                {t("crew.patrol.reentry.request")}
              </button>
            )}
          </div>
        </section>
      )}
      {status === "INACTIVE" && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-slate-700">
          <p className="font-semibold">{t("crew.patrol.inactive.title")}</p>
          <p className="mt-1 text-sm">{t("crew.patrol.inactive.body")}</p>
        </section>
      )}

      {canPatrol && (
        <>
          {/* The sweep — one row per room in patrol order. */}
          <section className="card divide-y divide-slate-100">
            {rooms.length === 0 ? (
              <p className="muted p-4">{t("crew.patrol.noRooms")}</p>
            ) : (
              rooms.map((room, i) => {
                const chosen = counts[room.id]?.headcount;
                return (
                  <div key={room.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="w-7 text-sm font-semibold text-slate-400">{i + 1}</span>
                    <span className="min-w-28 flex-1 font-medium text-slate-800">{room.name}</span>
                    <div className="flex flex-wrap gap-1">
                      {BUCKETS.map((b) => (
                        <button
                          key={b.value}
                          type="button"
                          onClick={() => pick(room.id, b.value)}
                          className={`h-9 w-10 rounded-md text-sm font-semibold transition-colors ${
                            chosen === b.value
                              ? "bg-accent-600 text-white"
                              : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <div className="space-y-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("crew.patrol.notePlaceholder")}
              rows={2}
              className="textarea"
            />
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={recorded === 0 || submit.isPending} onClick={onSubmit}>
                {submit.isPending
                  ? t("crew.patrol.submitting")
                  : t("crew.patrol.submit", { count: recorded })}
              </button>
              {submit.isSuccess && <span className="text-sm text-green-600">{t("crew.patrol.submitted")}</span>}
              {submit.error && <span className="text-sm text-red-600">{submit.error.message}</span>}
            </div>
          </div>

          {/* Recent patrols */}
          {(history.data?.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="section-title">{t("crew.patrol.recent")}</h2>
              <div className="card divide-y divide-slate-100">
                {(history.data ?? []).map((p) => (
                  <div key={p.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-800">
                      {new Date(p.createdAt).toLocaleString()} · {p.hours.toFixed(1)} h
                    </p>
                    <p className="muted mt-0.5 text-xs">
                      {p.observations
                        .map(
                          (o) =>
                            `${o.room.name}: ${
                              BUCKETS.find((b) => b.value === o.headcount)?.label ?? o.headcount
                            }`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Opt-out (ACTIVE crew only — not elevated admins, who have no crew status) */}
          {status === "ACTIVE" && (
            <section className="card p-4">
              {pending?.kind === "OPT_OUT" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-slate-700">{t("crew.patrol.optOut.pending")}</span>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={recall.isPending}
                    onClick={() => recall.mutate()}
                  >
                    {t("crew.patrol.optOut.recall")}
                  </button>
                </div>
              ) : showOptOut ? (
                <div className="space-y-2">
                  <textarea
                    value={optOutReason}
                    onChange={(e) => setOptOutReason(e.target.value)}
                    placeholder={t("crew.patrol.optOut.reason")}
                    rows={2}
                    className="textarea"
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary btn-sm"
                      disabled={optOut.isPending}
                      onClick={() =>
                        optOut.mutate({ reason: optOutReason.trim() || undefined })
                      }
                    >
                      {t("crew.patrol.optOut.submit")}
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => setShowOptOut(false)}>
                      {t("common.close")}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="link text-sm" onClick={() => setShowOptOut(true)}>
                  {t("crew.patrol.optOut.request")}
                </button>
              )}
              {(optOut.error ?? recall.error) && (
                <p className="mt-2 text-sm text-red-600">{(optOut.error ?? recall.error)?.message}</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
