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
  onEditAgain,
  restartBusy = false,
  restartError,
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  saved?: boolean;
  refreshFailed?: boolean;
  onEditAgain?: () => void;
  restartBusy?: boolean;
  restartError?: string | null;
}) {
  const dialogBusy = useDialogBusy();
  const t = useTranslations("accountProfile");
  return (
    <>
      <FormSection
        title={title}
        busy={busy || dialogBusy}
        disabled={saved}
        actions={actions}
      >
        <div className={className ?? "space-y-4"}>{children}</div>
      </FormSection>
      {/* Completion belongs to this section. It never closes a sibling's draft or registers work. */}
      {(saved || refreshFailed || restartError) && (
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
          {/* Restart is a read, outside the committed fieldset. The feature adopts
          a fresh snapshot before unlocking only its own independent draft. */}
          {saved && onEditAgain && (
            <Button
              type="button"
              disabled={busy || dialogBusy || restartBusy}
              onClick={onEditAgain}
            >
              {t("editAgain")}
            </Button>
          )}
          {restartError && (
            <InlineNotice tone="warning" announcement="alert">
              {restartError}
            </InlineNotice>
          )}
        </div>
      )}
    </>
  );
}
