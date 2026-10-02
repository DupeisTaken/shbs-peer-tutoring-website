"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { AcademicError } from "~/app/_components/academic-error";
import { useRouter } from "next/navigation";
import { useDialog } from "~/app/_components/confirm-dialog";

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
    <section className="border-accent-200 bg-accent-50 rounded-lg border p-5">
      {dialog}
      <h2 className="text-accent-900 text-lg font-bold">
        {t("tutor.activate.title")}
      </h2>
      <p className="text-accent-800 mt-1 text-sm">{t("tutor.activate.body")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="btn-primary"
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
        </button>
        <button
          className="btn-secondary"
          disabled={activate.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: t("tutor.activate.optOut"),
                message: t("tutor.tasks.confirmOptOut"),
                confirmLabel: t("tutor.activate.optOut"),
                cancelLabel: t("common.cancel"),
                danger: true,
              })
            )
              activate.mutate({ available: false });
          }}
        >
          {t("tutor.activate.optOut")}
        </button>
      </div>
      <p className="muted mt-2 text-xs">{t("tutor.activate.note")}</p>
      {activate.isSuccess && <p role="status">{t("workflows.saved")}</p>}
      {activate.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          <AcademicError message={activate.error.message} selfService />
        </p>
      )}
    </section>
  );
}
