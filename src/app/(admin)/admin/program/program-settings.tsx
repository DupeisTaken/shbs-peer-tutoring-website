"use client";

import { ProgramCaptchaSettings } from "~/app/_components/program-captcha-settings";
import { Suspense, useEffect, useState, type ReactNode } from "react";
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
import { NextRecruitmentSettings } from "~/app/_components/next-recruitment-settings";
import { ProgramRefresh } from "~/app/_components/program-refresh";
import { SchoolCalendar } from "~/app/_components/school-calendar";
import { ProgramCalendarSettings } from "~/app/_components/program-calendar";
import { MessagePermissions } from "~/app/_components/message-admin";
import { ProgramNameSettings } from "~/app/_components/program-name-settings";
import { api, type RouterOutputs } from "~/trpc/react";
import { StatePanel } from "~/app/_components/ui/patterns";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { FeatureToggles } from "~/app/_components/program-feature-settings";
import { useReadOnly } from "~/app/_components/read-only";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { ProgramWriteAdmissionProvider } from "~/app/_components/program-write-admission";

export default function ProgramSettings({ deliveryQuota }: { deliveryQuota?: ReactNode }) {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <StatePanel kind="loading" title={t("admin.program.loading")} />
      }
    >
      <ProgramSettingsPage deliveryQuota={deliveryQuota} />
    </Suspense>
  );
}
const programPanels = ["period", "people", "communication", "access"] as const;
type ProgramPanel = (typeof programPanels)[number];
type CurrentPeriod = NonNullable<RouterOutputs["admin"]["currentPeriod"]>;
function ProgramSettingsPage({ deliveryQuota }: { deliveryQuota?: ReactNode }) {
  const t = useTranslations();
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
  // Ordinary account-read failures retain the same authorized identity's owners.
  // Public/observer period reads still confer no access to private settings.
  const canReadSettings =
    !readOnly &&
    !!account.data?.id &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(account.data?.role ?? "");
  const canWriteSettings =
    canReadSettings && account.isSuccess && !account.error;
  const settingsIdentity = `${account.data?.id ?? "unknown"}:${account.data?.role ?? "unknown"}`;

  const period = current.data;
  const canEditPeriod =
    canReadSettings &&
    ["HEAD", "ADMIN"].includes(account.data?.role ?? "") &&
    !!period?.canEdit;
  const canApplyPeriod =
    canEditPeriod && account.data?.role === "HEAD" && !!period?.canApply;
  // Named read-only recovery sits beside retained owners, including hidden panels.
  const privatePanelState = (key: ProgramPanel) => {
    const section = t(`admin.program.panels.${key}`);
    if (!account.data || account.error)
      return (
        <QueryFeedback
          hasData={canReadSettings}
          loading={!account.data}
          error={!!account.error}
          retrying={account.isFetching}
          loadingTitle={t("managementRecovery.loading", { section })}
          errorTitle={t("managementRecovery.loadFailed", { section })}
          retryLabel={t("managementRecovery.retry", { section })}
          onRetry={() => void account.refetch()}
        />
      );
    return (
      <StatePanel
        kind="denied"
        title={t("managementRecovery.denied", { section })}
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
      <ProgramWriteAdmissionProvider
        key={settingsIdentity}
        allowed={canWriteSettings}
      >
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
            {account.error && privatePanelState("period")}
            {current.error && (
              <QueryFeedback
                hasData={!!period}
                loading={current.isLoading}
                error
                retrying={current.isFetching}
                loadingTitle={t("admin.program.loading")}
                errorTitle={t("managementRecovery.loadFailed", {
                  section: t("admin.program.currentPeriod"),
                })}
                retryLabel={t("managementRecovery.retry", {
                  section: t("admin.program.currentPeriod"),
                })}
                onRetry={() => void current.refetch()}
              />
            )}
            {canReadSettings && (
              <>
                <ProgramTimeZoneSettings />
                <ProgramCalendarSettings />
                <SchoolCalendar />
              </>
            )}
            {period && (
              <ProgramPeriodSettings
                period={period}
                canReadSettings={canReadSettings}
                canApplyRecruitment={
                  canReadSettings &&
                  ["ADMIN", "HEAD"].includes(account.data?.role ?? "")
                }
                canEditPeriod={canEditPeriod}
                canApplyPeriod={canApplyPeriod}
                readFailed={!!current.error}
              />
            )}
          </div>
          <div hidden={panel !== "people"} className="space-y-6">
            {(!canReadSettings || account.error) && privatePanelState("people")}
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
            {(!canReadSettings || account.error) &&
              privatePanelState("communication")}
            {canReadSettings && (
              <>
                <ProgramEmailSettings deliveryQuota={["HEAD", "ADMIN"].includes(account.data?.role ?? "") ? deliveryQuota : null} />
                <ProgramCaptchaSettings />
              </>
            )}
          </div>
          <div hidden={panel !== "access"} className="space-y-6">
            {(!canReadSettings || account.error) && privatePanelState("access")}
            {period && canReadSettings && <FeatureToggles />}
          </div>
        </SectionTabs>
      </ProgramWriteAdmissionProvider>
    </div>
  );
}

/** This owner lives inside the account-keyed boundary. Replacing an identity
 * retires its activation state and any late callback from that old owner. */
function ProgramPeriodSettings({
  period,
  canReadSettings,
  canApplyRecruitment,
  canEditPeriod,
  canApplyPeriod,
  readFailed,
}: {
  period: CurrentPeriod;
  canReadSettings: boolean;
  canApplyRecruitment: boolean;
  canEditPeriod: boolean;
  canApplyPeriod: boolean;
  readFailed: boolean;
}) {
  // Only our accepted refresh replaces current-editor drafts automatically.
  // A remote period change remains an explicit Reload decision for each editor.
  const [activatedPeriod, setActivatedPeriod] = useState<CurrentPeriod | null>(
    null,
  );
  return (
    <>
      <ProgramWriteAdmissionProvider allowed={!readFailed}>
        {(["tutee", "tutor"] as const).map((audience) => (
          <RecruitmentSettings
            key={`${activatedPeriod?.termId ?? "current"}:${audience}`}
            termId={activatedPeriod?.termId ?? period.termId}
            audience={audience}
            window={(activatedPeriod ?? period).recruitment[audience]}
            canEdit={canReadSettings}
            canApply={canApplyRecruitment}
          />
        ))}
      </ProgramWriteAdmissionProvider>
      <ProgramPublicQrLinks />
      {canReadSettings && (
        <>
          <NextRecruitmentSettings />
          <ProgramWriteAdmissionProvider allowed={!readFailed}>
            <ProgramRefresh
              period={period}
              canEdit={canEditPeriod}
              canApply={canApplyPeriod}
              onActivated={setActivatedPeriod}
            />
          </ProgramWriteAdmissionProvider>
        </>
      )}
    </>
  );
}
