"use client";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AccountSettings } from "~/app/_components/account-settings";
import { MessageInbox } from "~/app/_components/message-inbox";

/** Personal controls do not grant participation. Keep the opaque student page
 * slot out of this branch and select only these existing ownership-scoped views. */
export function TuteePersonalView({ fallback }: { fallback: ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const t = useTranslations("tuteePortal");
  const views = params.getAll("view");
  const view = views.length === 1 ? views[0] : null;
  // Match the page's treatment of repeated parameters, and never interpret
  // a nested participation route or an unknown value as personal access.
  if (path !== "/student" || (view !== "account" && view !== "messages"))
    return fallback;
  return (
    <>
      <div>
        <p className="muted text-xs font-semibold tracking-wider uppercase">
          {t("title")}
        </p>
        <h1 className="page-title mt-1">{t(view)}</h1>
      </div>
      {view === "account" ? <AccountSettings embedded /> : <MessageInbox />}
    </>
  );
}
