"use client";

import { ProgramCaptchaSettings } from "~/app/_components/program-captcha-settings";
import { Suspense, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useSessionAccessDenied,
  useSessionPageScroll,
  useSessionViewState,
  useSessionViewVerified,
} from "~/app/_components/session-view-state";
import { viewEnum } from "~/lib/session-view-state";
import { ProgramProfileSettings } from "~/app/_components/program-profile-settings";
import { ProgramEmailSettings } from "~/app/_components/program-email-settings";
import { useTranslations } from "next-intl";

import { ProgramTimeZoneSettings } from "~/app/_components/program-time-zone-settings";
import { RecruitmentSettings } from "~/app/_components/recruitment-settings";
import { ProgramPublicQrLinks } from "~/app/_components/program-public-qr-links";
import { SchoolCalendar } from "~/app/_components/school-calendar";
import { ProgramCalendarSettings } from "~/app/_components/program-calendar";
import { MessagePermissions } from "~/app/_components/message-admin";
import { ProgramNameSettings } from "~/app/_components/program-name-settings";
import { api } from "~/trpc/react";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { FeatureToggles } from "~/app/_components/program-feature-settings";
import { useReadOnly } from "~/app/_components/read-only";

type RefreshResult = {
  name: string;
  archivedTutees: number;
  graduatedTutors: number;
  agedTutors: number;
  pendingTutors: number;
};

export default function ProgramPage() {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <StatePanel kind="loading" title={t("admin.program.loading")} />
      }
    >
      <ProgramSettingsPage />
    </Suspense>
  );
}
const programPanels = ["period", "people", "communication", "access"] as const;
type ProgramPanel = (typeof programPanels)[number];
function ProgramSettingsPage() {
  const confirmationId = useId();
  const t = useTranslations();
  const utils = api.useUtils();
  const current = api.admin.currentPeriod.useQuery();
  const account = api.account.me.useQuery();
  const denied = useSessionAccessDenied(current, account);
  const params = useSearchParams();
  const router = useRouter();
  const verified = useSessionViewVerified();
  const explicitPanel = viewEnum(programPanels)(params.get("panel"));
  const [remembered, remember] = useSessionViewState<ProgramPanel>({
    id: "program-panel-v1",
    initialState: "period",
    parse: viewEnum(programPanels),
    enabled: !denied,
  });
  const [pendingPanel, setPendingPanel] = useState<{
    query: string;
    panel: ProgramPanel;
  } | null>(null);
  // Valid direct links win on entry. A click responds immediately while Next commits its URL.
  const panel =
    pendingPanel?.query === params.toString()
      ? pendingPanel.panel
      : (explicitPanel ?? remembered);
  const setPanel = (panel: ProgramPanel) => {
    remember(panel);
    setPendingPanel({ query: params.toString(), panel });
    const next = new URLSearchParams(params.toString());
    next.set("panel", panel);
    router.replace(`/admin/program?${next.toString()}`, { scroll: false });
  };
  useEffect(() => {
    if (verified && explicitPanel) remember(explicitPanel);
  }, [verified, explicitPanel, remember]);
  useSessionPageScroll({
    id: "program-settings-v1",
    scope: panel,
    ready: !!current.data && !!account.data,
    enabled: !denied,
  });
  const readOnly = useReadOnly();
  // Public/observer period reads do not confer access to private settings children.
  const canReadSettings =
    !readOnly &&
    !account.error &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(account.data?.role ?? "");

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
  const canEditPeriod = canReadSettings && !current.error && !!period?.canEdit;
  const canApplyPeriod =
    canEditPeriod && account.data?.role === "HEAD" && !!period?.canApply;
  const confirmOk = confirm.trim().toUpperCase() === "REFRESH";
  // The panel owns feedback; denied/unknown identities never mount private query children.
  const privatePanelState = (key: "people" | "communication" | "access") => {
    const section = t(`admin.program.panels.${key}`);
    return (
      <StatePanel
        kind={account.error ? "error" : account.data ? "denied" : "loading"}
        title={t(
          account.error
            ? "managementRecovery.loadFailed"
            : account.data
              ? "managementRecovery.denied"
              : "managementRecovery.loading",
          { section },
        )}
        action={
          account.error && (
            <button
              className="btn-secondary min-h-11 lg:min-h-8"
              onClick={() => void account.refetch()}
            >
              {t("managementRecovery.retry", { section })}
            </button>
          )
        }
      />
    );
  };

  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={t("managementRecovery.denied", {
          section: t("admin.program.title"),
        })}
      />
    );

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">{t("admin.program.title")}</h1>
        <p className="muted mt-1">{t("admin.program.subtitle")}</p>
      </div>

      {current.isLoading ? (
        <p className="muted">{t("admin.program.loading")}</p>
      ) : !period ? (
        <p className="text-sm text-red-600">{t("admin.program.noPeriod")}</p>
      ) : (
        <section className="card p-5">
          <p className="muted text-xs">{t("admin.program.currentPeriod")}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {period.name}
          </p>
          <p className="muted mt-1">
            {t("admin.program.semester", { semester: period.semester })}
          </p>
        </section>
      )}
      <SectionTabs
        label={t("admin.program.title")}
        value={panel}
        onChange={setPanel}
        items={(["period", "people", "communication", "access"] as const).map(
          (value) => ({
            value,
            label: t(`admin.program.panels.${value}`),
          }),
        )}
      >
        {/* Hidden panels retain independent settings drafts and refresh confirmation. */}
        <div hidden={panel !== "period"} className="space-y-6">
          {canReadSettings && (
            <>
              <ProgramTimeZoneSettings />
              <ProgramCalendarSettings />
              <SchoolCalendar />
            </>
          )}
          {period && (
            <>
              {(["tutee", "tutor"] as const).map((audience) => (
                <RecruitmentSettings
                  key={audience}
                  termId={period.termId}
                  audience={audience}
                  window={period.recruitment[audience]}
                  canEdit={canEditPeriod}
                  canApply={canApplyPeriod}
                />
              ))}

              <ProgramPublicQrLinks />

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
                  <label className="label" htmlFor={confirmationId}>
                    {t("admin.program.confirmLabel")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id={confirmationId}
                      value={confirm}
                      disabled={!canEditPeriod || refresh.isPending}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t("admin.program.confirmPlaceholder")}
                      className="input field-auto min-w-44"
                    />
                    <button
                      className="btn-danger"
                      disabled={
                        !canEditPeriod || !confirmOk || refresh.isPending
                      }
                      onClick={() => {
                        if (!canEditPeriod || refresh.isPending) return;
                        setDone(null);
                        refresh.mutate({
                          confirm,
                          expectedTermId: period.termId,
                        });
                      }}
                    >
                      {refresh.isPending
                        ? t("admin.program.refreshing")
                        : !canApplyPeriod
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
            </>
          )}
        </div>
        <div hidden={panel !== "people"} className="space-y-6">
          {!canReadSettings && privatePanelState("people")}
          {canReadSettings && (
            <>
              <ProgramProfileSettings />
              <ProgramNameSettings />
            </>
          )}
          {canReadSettings &&
            ["HEAD", "ADMIN"].includes(account.data?.role ?? "") && (
              <MessagePermissions />
            )}
        </div>
        <div hidden={panel !== "communication"} className="space-y-6">
          {!canReadSettings && privatePanelState("communication")}
          {canReadSettings && (
            <>
              <ProgramEmailSettings />
              <ProgramCaptchaSettings />
            </>
          )}
        </div>
        <div hidden={panel !== "access"} className="space-y-6">
          {!canReadSettings && privatePanelState("access")}
          {period && canReadSettings && <FeatureToggles />}
        </div>
      </SectionTabs>
    </div>
  );
}
