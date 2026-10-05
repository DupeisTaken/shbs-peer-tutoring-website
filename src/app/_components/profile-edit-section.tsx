"use client";

import type { ReactNode } from "react";
import { FormSection, InlineNotice } from "./ui/patterns";
import { useDialogBusy } from "./ui/modal";
import { useTranslations } from "next-intl";

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
}: {
  title: string;
  busy: boolean;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  saved?: boolean;
  refreshFailed?: boolean;
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
    </>
  );
}
