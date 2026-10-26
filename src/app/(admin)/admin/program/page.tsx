"use client";

import { ProgramCaptchaSettings } from "~/app/_components/program-captcha-settings";
import { Suspense, useEffect, useState } from "react";
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
  // Public/observer period reads do not confer access to private settings children.
  const canReadSettings =
    !readOnly &&
    !account.error &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(account.data?.role ?? "");

  const period = current.data;
  // Only our accepted refresh replaces current-editor drafts automatically.
  // A remote period change remains an explicit Reload decision for each editor.
  const [activatedPeriod, setActivatedPeriod] = useState<RouterOutputs["admin"]["currentPeriod"]>(null);
  const canEditPeriod = canReadSettings && ["HEAD", "ADMIN"].includes(account.data?.role ?? "") && !current.error && !!period?.canEdit;
  const canApplyPeriod =
    canEditPeriod && account.data?.role === "HEAD" && !!period?.canApply;
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
                  key={`${activatedPeriod?.termId ?? "current"}:${audience}`}
                  termId={activatedPeriod?.termId ?? period.termId}
                  audience={audience}
                  window={(activatedPeriod ?? period).recruitment[audience]}
                  canEdit={canEditPeriod}
                  canApply={canApplyPeriod}
                />
              ))}

              <ProgramPublicQrLinks />

              {canReadSettings && <><NextRecruitmentSettings /><ProgramRefresh period={period} canEdit={canEditPeriod} canApply={canApplyPeriod} onActivated={setActivatedPeriod} /></>}
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
