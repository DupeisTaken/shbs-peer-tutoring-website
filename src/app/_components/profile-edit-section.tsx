"use client";

import type { ReactNode } from "react";
import { FormSection, InlineNotice } from "./ui/patterns";
import { useDialogBusy } from "./ui/modal";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";

/** The fieldset lives inside the dialog provider, so a write in any independent
 * profile section freezes this draft without combining their forms or versions. */
export function ProfileEditSection({
  title,
  busy,
  children,
  actions,
  className,
  saved = false,
  refreshFailed = false,
  readOnly = saved,
  onRefresh,
  refreshBusy = false,
  refreshError,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  saved?: boolean;
  refreshFailed?: boolean;
  /** Saved feedback and write admission are separate after automatic synchronization. */
  readOnly?: boolean;
  onRefresh?: () => void;
  refreshBusy?: boolean;
  refreshError?: string | null;
}) {
  const dialogBusy = useDialogBusy();
  const t = useTranslations("accountProfile");
  return (
    <>
      <FormSection
        title={title}
        busy={busy || dialogBusy}
        disabled={readOnly}
        actions={actions}
      >
        <div className={className ?? "space-y-4"}>{children}</div>
      </FormSection>
      {/* Completion belongs to this section. It never closes a sibling's draft or registers work. */}
      {(saved || refreshFailed || refreshError) && (
        <div className="mt-4 space-y-3">
          {saved && (
            <InlineNotice tone="success" announcement="status">
              {t("sectionSaved")}
            </InlineNotice>
          )}
          {refreshFailed && (
            <InlineNotice tone="warning" announcement="alert">
              {t("sectionRefreshFailed")}
            </InlineNotice>
          )}
          {/* Recovery is a read outside the committed fieldset; accepted writes
          are never replayed when automatic synchronization fails. */}
          {saved && refreshFailed && onRefresh && (
            <Button
              type="button"
              disabled={busy || dialogBusy || refreshBusy}
              onClick={onRefresh}
            >
              {t("retryRefresh")}
            </Button>
          )}
          {refreshError && (
            <InlineNotice tone="warning" announcement="alert">
              {refreshError}
            </InlineNotice>
          )}
        </div>
      )}
    </>
  );
}
