"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { AcademicError } from "~/app/_components/academic-error";
import { useRouter } from "next/navigation";
import { useDialog } from "~/app/_components/confirm-dialog";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";

/**
 * Start-of-term activation prompt, shown when the tutor's status is PENDING (a semester refresh
 * set them dormant). They choose to be available (→ ACTIVE) or opt out (→ OPTED_OUT); the choice
 * syncs to the admin views. The page reloads its session-derived data after the choice.
 */
export function TutorActivation() {
  const t = useTranslations();
  const utils = api.useUtils();
  const router = useRouter();
  const { confirm, dialog } = useDialog();
  const activate = api.tutor.activateAccount.useMutation({
    onSuccess: async () => {
      // Membership controls and attendance eligibility come from the server page.
      // Refresh that payload as well as the client cache after the applied choice.
      router.refresh();
      await utils.tutor.me.invalidate();
    },
  });

  return (
    <section className="border-accent-200 bg-accent-50 rounded-xl border p-4 sm:p-5">
      {dialog}
      <h2 className="section-title text-accent-900">
        {t("tutor.activate.title")}
      </h2>
      <p className="text-accent-800 mt-1 text-sm">{t("tutor.activate.body")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={activate.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: t("tutor.activate.available"),
                message: t("tutor.tasks.confirmActivate"),
                confirmLabel: t("tutor.activate.available"),
                cancelLabel: t("common.cancel"),
              })
            )
              activate.mutate({ available: true });
          }}
        >
          {t("tutor.activate.available")}
        </Button>
        <Button
          variant="danger"
          disabled={activate.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: t("tutor.activate.optOut"),
                message: t("tutor.tasks.confirmOptOut"),
                confirmLabel: t("tutor.activate.optOut"),
                cancelLabel: t("common.cancel"),
                danger: true,
                confirmDelayMs: 3_000,
              })
            )
              activate.mutate({ available: false });
          }}
        >
          {t("tutor.activate.optOut")}
        </Button>
      </div>
      <p className="muted mt-2 text-xs">{t("tutor.activate.note")}</p>
      {activate.isSuccess && (
        <div className="mt-3">
          <InlineNotice tone="success" announcement="status">
            {t("workflows.saved")}
          </InlineNotice>
        </div>
      )}
      {activate.error && (
        <div className="mt-3">
          <InlineNotice tone="error" announcement="alert">
            <AcademicError message={activate.error.message} selfService />
          </InlineNotice>
        </div>
      )}
    </section>
  );
}
