"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";

/** Synthetic local failures exercise the production review composition without
 * issuing a mutation or granting any management permission. */
export function ActionReviewRecipe() {
  const t = useTranslations("actionReview");
  const review = useActionReview();
  const [sequence, setSequence] = useState(0);
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("galleryTitle")}</h2>
      <p className="muted text-sm">{t("galleryHelp")}</p>
      <code className="block text-xs text-slate-500">
        useActionReview + Modal + InlineNotice
      </code>
      <Button
        onClick={() => {
          let attempts = 0;
          let refreshes = 0;
          setSequence((value) => value + 1);
          review.open({
            key: `example-${sequence}`,
            title: t("pairingTitle"),
            description: t("pairingHelp"),
            confirmLabel: t("galleryOpen"),
            details: <p>{t("galleryRecord")}</p>,
            commit: async () => {
              if (++attempts === 1) throw new Error(t("failed"));
            },
            refresh: async () => {
              if (++refreshes === 1) throw new Error("Synthetic read failure");
            },
          });
        }}
      >
        {t("galleryOpen")}
      </Button>
      {review.dialog}
    </section>
  );
}
