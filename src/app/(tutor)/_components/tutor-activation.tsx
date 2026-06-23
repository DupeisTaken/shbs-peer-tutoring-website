"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Start-of-term activation prompt, shown when the tutor's status is PENDING (a semester refresh
 * set them dormant). They choose to be available (→ ACTIVE) or opt out (→ OPTED_OUT); the choice
 * syncs to the admin views. The page reloads its session-derived data after the choice.
 */
export function TutorActivation() {
  const t = useTranslations();
  const utils = api.useUtils();
  const activate = api.tutor.activateAccount.useMutation({
    onSuccess: () => utils.tutor.me.invalidate(),
  });

  return (
    <section className="rounded-lg border border-accent-200 bg-accent-50 p-5">
      <h2 className="text-lg font-bold text-accent-900">{t("tutor.activate.title")}</h2>
      <p className="mt-1 text-sm text-accent-800">{t("tutor.activate.body")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="btn-primary"
          disabled={activate.isPending}
          onClick={() => activate.mutate({ available: true })}
        >
          {t("tutor.activate.available")}
        </button>
        <button
          className="btn-secondary"
          disabled={activate.isPending}
          onClick={() => activate.mutate({ available: false })}
        >
          {t("tutor.activate.optOut")}
        </button>
      </div>
      <p className="muted mt-2 text-xs">{t("tutor.activate.note")}</p>
      {activate.error && <p className="mt-2 text-sm text-red-600">{activate.error.message}</p>}
    </section>
  );
}
