"use client";

import { ProgramCaptchaSettings } from "~/app/_components/program-captcha-settings";
import { useState } from "react";
import { ProgramProfileSettings } from "~/app/_components/program-profile-settings";
import { ProgramEmailSettings } from "~/app/_components/program-email-settings";
import { useTranslations } from "next-intl";

import { ProgramTimeZoneSettings } from "~/app/_components/program-time-zone-settings";
import { RecruitmentSettings } from "~/app/_components/recruitment-settings";
import { api } from "~/trpc/react";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { FeatureToggles } from "~/app/_components/program-feature-settings";

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
      <ProgramCaptchaSettings />
      <ProgramProfileSettings />
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
              key={audience}
              termId={period.termId}
              audience={audience}
              window={period.recruitment[audience]}
              canEdit={period.canEdit}
              canApply={period.canApply}
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
                  disabled={!period.canEdit || refresh.isPending}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t("admin.program.confirmPlaceholder")}
                  className="input field-auto min-w-44"
                />
                <button
                  className="btn-danger"
                  disabled={!period.canEdit || !confirmOk || refresh.isPending}
                  onClick={() => {
                    if (!period.canEdit || refresh.isPending) return;
                    setDone(null);
                    refresh.mutate({ confirm, expectedTermId: period.termId });
                  }}
                >
                  {refresh.isPending
                    ? t("admin.program.refreshing")
                    : period.canApply === false
                      ? t("approvals.requestHead")
                      : t("admin.program.refreshButton", {
                          name: period.next.name,
                        })}
                </button>
              </div>
              {refresh.error?.data?.approvalId && (
                <InlineNotice tone="warning" announcement="status">
                  {t("approvals.queuedBody")}
                </InlineNotice>
              )}
              {refresh.error && !refresh.error.data?.approvalId && (
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
