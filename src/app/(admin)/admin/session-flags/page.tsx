"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { minToHm } from "~/lib/time";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Attendance discrepancy review: the crew saw fewer students than a tutor marked present. Each flag
 * is a request for an admin to decide — dismiss, warn, apply an hour penalty, or escalate. Like the
 * removal queues. VIEWER is read-only.
 */
export default function SessionFlagsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const flags = api.admin.sessionFlags.useQuery();
  const decide = api.admin.decideSessionFlag.useMutation({
    onSuccess: () => utils.admin.sessionFlags.invalidate(),
  });

  const [note, setNote] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<Record<string, string>>({});

  const list = flags.data ?? [];

  const act = (id: string, action: "DISMISS" | "WARN" | "PENALIZE" | "ESCALATE") => {
    const noteText = note[id]?.trim() ?? "";
    // Empty / zero / non-numeric input falls back to the default 0.5h penalty.
    const parsed = Number(hours[id] ?? "0.5");
    const penalty = Number.isFinite(parsed) && parsed > 0 ? parsed : 0.5;
    decide.mutate({
      flagId: id,
      action,
      note: noteText.length > 0 ? noteText : undefined,
      penaltyHours: action === "PENALIZE" ? penalty : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.sessionFlags.title")}</h1>
        <p className="muted mt-1">{t("admin.sessionFlags.help")}</p>
      </div>

      {decide.error && <p className="text-sm text-red-600">{decide.error.message}</p>}

      <div className="space-y-3">
        {list.map((f) => (
          <div key={f.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {f.tutor} · {f.subject}{" "}
                  <span className="badge-red ml-1">
                    {t("admin.sessionFlags.discrepancy", { observed: f.observed, expected: f.expected })}
                  </span>
                </p>
                <p className="muted mt-1 text-xs">
                  {t("admin.sessionFlags.context", {
                    room: f.room ?? "—",
                    date: new Date(f.date).toLocaleDateString(),
                    start: minToHm(f.startMin),
                    end: minToHm(f.endMin),
                  })}
                </p>
              </div>
            </div>

            {!readOnly && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input
                  className="input w-full text-sm"
                  placeholder={t("admin.sessionFlags.notePlaceholder")}
                  value={note[f.id] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [f.id]: e.target.value }))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-secondary btn-sm"
                    disabled={decide.isPending}
                    onClick={() => act(f.id, "DISMISS")}
                  >
                    {t("admin.sessionFlags.dismiss")}
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={decide.isPending}
                    onClick={() => act(f.id, "WARN")}
                  >
                    {t("admin.sessionFlags.warn")}
                  </button>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={hours[f.id] ?? "0.5"}
                      onChange={(e) => setHours((h) => ({ ...h, [f.id]: e.target.value }))}
                      aria-label={t("admin.sessionFlags.penaltyHours")}
                      className="input field-auto w-16 text-sm"
                    />
                    <button
                      className="btn-secondary btn-sm"
                      disabled={decide.isPending}
                      onClick={() => act(f.id, "PENALIZE")}
                    >
                      {t("admin.sessionFlags.penalize")}
                    </button>
                  </span>
                  <button
                    className="btn-danger btn-sm"
                    disabled={decide.isPending}
                    onClick={() => act(f.id, "ESCALATE")}
                  >
                    {t("admin.sessionFlags.escalate")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="muted">{t("admin.sessionFlags.empty")}</p>}
      </div>
    </div>
  );
}
