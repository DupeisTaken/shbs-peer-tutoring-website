"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

export default function ProgramPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const current = api.admin.currentPeriod.useQuery();
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<{ name: string; archivedTutees: number } | null>(null);

  const refresh = api.admin.refresh.useMutation({
    onSuccess: async (res) => {
      setConfirm("");
      setDone({ name: res.name, archivedTutees: res.archivedTutees });
      await utils.admin.invalidate(); // period, pairings, tutees, summaries all change
    },
  });

  const period = current.data;
  const canRefresh = confirm.trim().toUpperCase() === "REFRESH" && !refresh.isPending;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">{t("admin.program.title")}</h1>
        <p className="muted mt-1">{t("admin.program.subtitle")}</p>
      </div>

      {current.isLoading ? (
        <p className="muted">{t("admin.program.loading")}</p>
      ) : !period ? (
        <p className="text-sm text-red-600">{t("admin.program.noPeriod")}</p>
      ) : (
        <>
          {/* Current period */}
          <section className="card p-5">
            <p className="muted text-xs">{t("admin.program.currentPeriod")}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{period.name}</p>
            <p className="muted mt-1">
              {t("admin.program.semester", { semester: period.semester })}
            </p>
          </section>

          {/* Refresh */}
          <section className="card border-amber-200 p-5">
            <h2 className="section-title">{t("admin.program.refreshHeading")}</h2>
            <p className="muted mt-1">
              {t("admin.program.advancesTo", { name: period.next.name })}
            </p>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>{t("admin.program.effectPending")}</li>
              <li>{t("admin.program.effectTutees")}</li>
              <li>{t("admin.program.effectPairings")}</li>
              <li>
                {period.next.crossesSemester
                  ? t("admin.program.effectHoursReset", { semester: period.next.semester })
                  : t("admin.program.effectHoursKeep")}
              </li>
            </ul>

            <div className="mt-4 space-y-2">
              <label className="label">{t("admin.program.confirmLabel")}</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t("admin.program.confirmPlaceholder")}
                  className="input max-w-[14rem]"
                />
                <button
                  className="btn-danger"
                  disabled={!canRefresh}
                  onClick={() => {
                    setDone(null);
                    refresh.mutate({ confirm });
                  }}
                >
                  {refresh.isPending
                    ? t("admin.program.refreshing")
                    : t("admin.program.refreshButton", { name: period.next.name })}
                </button>
              </div>
              {refresh.error && (
                <p className="text-sm text-red-600">{refresh.error.message}</p>
              )}
              {done && (
                <p className="text-sm text-green-700">
                  {t("admin.program.done", { name: done.name, count: done.archivedTutees })}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
