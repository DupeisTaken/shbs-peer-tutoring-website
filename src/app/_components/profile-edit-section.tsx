"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useDialogBusy } from "./ui/modal";
import { FormSection } from "./ui/form-section";

/** Independent sections share pending controls, never their drafts or completion.
 * Keep existing field/action placement; saved state owns no dialog registration. */
export function ProfileEditSection({
  children,
  busy,
  saved = false,
  refreshFailed = false,
  className,
}: {
  children: ReactNode;
  busy: boolean;
  saved?: boolean;
  refreshFailed?: boolean;
  className?: string;
}) {
  const dialogBusy = useDialogBusy();
  const t = useTranslations("accountProfile");
  return (
    <>
      <FormSection
        busy={busy || dialogBusy}
        disabled={saved}
        className={className}
      >
        {children}
      </FormSection>
      {saved && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {t("sectionSaved")}
        </p>
      )}
      {refreshFailed && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {t("sectionRefreshFailed")}
        </p>
      )}
    </>
  );
}
