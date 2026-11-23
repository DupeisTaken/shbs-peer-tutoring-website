"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { PublicHeader } from "~/app/_components/public-header";
import { Button } from "~/app/_components/ui/button";
import { FormActions, StatePanel } from "~/app/_components/ui/patterns";

/** Branded, localized route-level error boundary with explicit retry and safe home navigation. */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  return (
    <div className="min-h-screen">
      <PublicHeader sticky={false} skipLabel={t("common.skipToContent")} />
      <main
        id="main-content"
        className="mx-auto max-w-lg px-4 pt-10 pb-12 sm:px-6"
      >
        <StatePanel kind="error" title={t("pageRecovery.errorTitle")}>
          <p>{t("pageRecovery.errorBody")}</p>
          <FormActions>
            <Button variant="primary" onClick={() => reset()}>
              {t("uiPatterns.retry")}
            </Button>
            <Link href="/" className="btn-secondary control-standard">
              {t("workflows.home")}
            </Link>
          </FormActions>
        </StatePanel>
      </main>
    </div>
  );
}
