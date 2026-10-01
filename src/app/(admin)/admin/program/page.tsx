"use client";

import { useState } from "react";
import { ProgramEmailSettings } from "~/app/_components/program-email-settings";
import { useTranslations } from "next-intl";

import { ProgramTimeZoneSettings } from "~/app/_components/program-time-zone-settings";
import { RecruitmentSettings } from "~/app/_components/recruitment-settings";
import { api } from "~/trpc/react";
import { Switch } from "~/app/_components/ui/button";

type RefreshResult = {
  name: string;
  archivedTutees: number;
  graduatedTutors: number;
  agedTutors: number;
  pendingTutors: number;
};

export default function ProgramPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const current = api.admin.currentPeriod.useQuery();

  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<RefreshResult | null>(null);

  const refresh = api.admin.refresh.useMutation({
    onSuccess: async (res) => {
      setConfirm("");
      setDone(res);
      await utils.admin.invalidate();
    },
  });

  const period = current.data;
  const confirmOk = confirm.trim().toUpperCase() === "REFRESH";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">{t("admin.program.title")}</h1>
        <p className="muted mt-1">{t("admin.program.subtitle")}</p>
      </div>

      <ProgramTimeZoneSettings />
      <ProgramEmailSettings />
      {current.isLoading ? (
        <p className="muted">{t("admin.program.loading")}</p>
      ) : !period ? (
        <p className="text-sm text-red-600">{t("admin.program.noPeriod")}</p>
      ) : (
        <>
          <section className="card p-5">
            <p className="muted text-xs">{t("admin.program.currentPeriod")}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {period.name}
            </p>
            <p className="muted mt-1">
              {t("admin.program.semester", { semester: period.semester })}
            </p>
          </section>

          {(["tutee", "tutor"] as const).map((audience) => (
            <RecruitmentSettings
              key={`${period.termId}-${audience}`}
              termId={period.termId}
              audience={audience}
              window={period.recruitment[audience]}
            />
          ))}

          <section className="card border-amber-200 p-5">
            <h2 className="section-title">
              {t("admin.program.refreshHeading")}
            </h2>
            <p className="muted mt-1">
              {t("admin.program.advancesTo", { name: period.next.name })}
            </p>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>{t("admin.program.effectTutees")}</li>
              <li>{t("admin.program.effectPairings")}</li>
              {period.next.crossesSemester && (
                <li>{t("admin.program.effectReactivate")}</li>
              )}
              {period.next.graduates && (
                <li>{t("admin.program.effectGraduate")}</li>
              )}
              {period.next.crossesYear && (
                <li>{t("admin.program.effectAgeUp")}</li>
              )}
              <li>
                {period.next.crossesSemester
                  ? t("admin.program.effectHoursReset", {
                      semester: period.next.semester,
                    })
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
                  className="input field-auto min-w-44"
                />
                <button
                  className="btn-danger"
                  disabled={!confirmOk || refresh.isPending}
                  onClick={() => {
                    setDone(null);
                    refresh.mutate({ confirm, expectedTermId: period.termId });
                  }}
                >
                  {refresh.isPending
                    ? t("admin.program.refreshing")
                    : t("admin.program.refreshButton", {
                        name: period.next.name,
                      })}
                </button>
              </div>
              {refresh.error && (
                <p className="mt-2 text-sm text-red-600">
                  {refresh.error.message}
                </p>
              )}
              {done && (
                <p className="mt-2 text-sm text-green-700">
                  {t("admin.program.done", {
                    name: done.name,
                    count: done.archivedTutees,
                  })}
                  {(done.graduatedTutors > 0 || done.agedTutors > 0) &&
                    ` ${t("admin.program.doneGrad", { graduated: done.graduatedTutors, aged: done.agedTutors })}`}
                  {done.pendingTutors > 0 &&
                    ` ${t("admin.program.donePending", { count: done.pendingTutors })}`}
                </p>
              )}
            </div>
          </section>

          <FeatureToggles />
        </>
      )}
    </div>
  );
}

/**
 * Optional-module toggles. Switching a module off hides its portals/entries program-wide; the
 * Quarter System toggle switches refresh granularity (on = quarters, off = semesters). Only the
 * head may change them, and changes are staged — they take effect at the next program refresh.
 */
function FeatureToggles() {
  const t = useTranslations();
  const utils = api.useUtils();
  const settings = api.program.featureSettings.useQuery();
  const setPending = api.program.setFeaturePending.useMutation({
    onSuccess: () => utils.program.invalidate(),
  });

  const data = settings.data;
  if (!data) return null;

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("admin.program.features.heading")}</h2>
      <p className="muted mt-1 text-sm">{t("admin.program.features.help")}</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.features.map((f) => {
          // `target` = the desired state (staged value if any, else the current effective value).
          const target = f.pending ?? f.enabled;
          return (
            <li key={f.key} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-44 flex-1">
                <p className="font-medium text-slate-800">
                  {t(`admin.program.features.name.${f.key}`)}
                </p>
                {f.key === "QUARTER_SYSTEM" && (
                  <p className="muted text-xs">
                    {t("admin.program.features.quarterNote")}
                  </p>
                )}
              </div>
              <span className={f.enabled ? "badge-green" : "badge-slate"}>
                {t(
                  f.enabled
                    ? "admin.program.features.on"
                    : "admin.program.features.off",
                )}
              </span>
              {f.pending !== null && (
                <span className="badge-amber">
                  {t("admin.program.features.pending", {
                    state: t(
                      f.pending
                        ? "admin.program.features.on"
                        : "admin.program.features.off",
                    ),
                  })}
                </span>
              )}
              {data.canEdit && (
                // Keep the staged-setting behavior while giving each compact switch a named touch target.
                <Switch
                  label={t(`admin.program.features.name.${f.key}`)}
                  checked={target}
                  disabled={setPending.isPending}
                  onChange={(enabled) =>
                    setPending.mutate({ key: f.key, enabled })
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
      {!data.canEdit && (
        <p className="muted mt-3 text-xs">
          {t("admin.program.features.headOnly")}
        </p>
      )}
      {setPending.error && (
        <p className="mt-2 text-sm text-red-600">{setPending.error.message}</p>
      )}
    </section>
  );
}
