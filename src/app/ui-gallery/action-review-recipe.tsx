"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";
import { FormActions, StatePanel } from "~/app/_components/ui/patterns";

/** Synthetic local failures exercise the production review composition without
 * issuing a mutation or granting any management permission. */
export function ActionReviewRecipe() {
  const t = useTranslations("actionReview");
  const review = useActionReview();
  const [sequence, setSequence] = useState(0);
  const [revoked, setRevoked] = useState(false);
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("galleryTitle")}</h2>
      <p className="muted text-sm">{t("galleryHelp")}</p>
      <code className="block text-xs text-slate-500">
        useActionReview + Modal + InlineNotice
      </code>
      <FormActions>
        <Button
          disabled={revoked || review.blocked(`example-${sequence}`)}
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
                if (++refreshes === 1)
                  throw new Error("Synthetic read failure");
              },
            });
          }}
        >
          {t("galleryOpen")}
        </Button>
        <Button
          disabled={revoked || review.blocked(`revocation-${sequence}`)}
          onClick={() => {
            setSequence((value) => value + 1);
            review.open({
              key: `revocation-${sequence}`,
              title: t("galleryRevokeScenario"),
              description: t("galleryHelp"),
              confirmLabel: t("galleryOpen"),
              details: (
                <div className="space-y-3">
                  <p>{t("galleryRecord")}</p>
                  <Button
                    onClick={() => {
                      setRevoked(true);
                      review.revoke();
                    }}
                  >
                    {t("galleryRevoke")}
                  </Button>
                </div>
              ),
              commit: async () => undefined,
              refresh: async () => undefined,
            });
          }}
        >
          {t("galleryRevokeScenario")}
        </Button>
      </FormActions>
      {revoked && (
        <StatePanel
          kind="denied"
          title={t("galleryRevoked")}
          action={
            <Button onClick={() => setRevoked(false)}>
              {t("galleryRestore")}
            </Button>
          }
        />
      )}
      {!revoked && review.dialog}
    </section>
  );
}
