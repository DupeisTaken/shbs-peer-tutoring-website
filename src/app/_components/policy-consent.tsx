"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Markdown } from "./markdown";
import { api } from "~/trpc/react";
import { TimedActionDialog } from "./timed-action-dialog";
import { CurrentPolicyDialog } from "./current-policy-dialog";

/** The server verifies the revision again on acceptance and on participation mutations. */
export function PolicyConsent({
  slug,
  children,
}: {
  slug: "tutor-policy" | "tutee-policy";
  children?: React.ReactNode;
}) {
  const t = useTranslations("workflows");
  const locale = useLocale();
  const query = api.student.policy.useQuery({ slug });
  const [signature, setSignature] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState(false);
  const save = api.student.acceptPolicy.useMutation({
    onSuccess: () => query.refetch(),
  });
  // Keep the reader open if a refresh finds a newly published, unaccepted revision.
  // Closing it reveals the ordinary consent flow; reading never records acceptance.
  const reader = viewing ? (
    <CurrentPolicyDialog
      documents={query.data?.documents}
      loading={query.isFetching}
      error={!!query.error}
      onRetry={() => void query.refetch()}
      onClose={() => setViewing(false)}
    />
  ) : null;
  if (query.error && !viewing)
    return (
      <p role="alert" className="card p-6 text-red-700">
        {query.error.message}
      </p>
    );
  if (!query.data) return reader ?? <p>{t("loading")}</p>;
  if (query.data.accepted || viewing)
    return (
      <>
        {query.data.accepted &&
          (children ?? (
            <p className="text-emerald-700">
              {/* A new rich-text key avoids legacy plain-text translation overrides. */}
              {t.rich("acceptedWithPolicy", {
                policy: (chunks) => (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    className="inline-flex min-h-11 items-center rounded-sm font-medium underline decoration-emerald-700/50 underline-offset-4 hover:decoration-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 lg:min-h-0"
                    onClick={() => {
                      setViewing(true);
                      void query.refetch();
                    }}
                  >
                    {chunks}
                  </button>
                ),
              })}
            </p>
          ))}
        {reader}
      </>
    );
  const document =
    query.data.documents.find((d) => d.locale === locale) ??
    query.data.documents.find((d) => d.locale === "en")!;
  return (
    <section className="card space-y-4 p-6">
      {confirming && (
        <TimedActionDialog
          action="POLICY"
          target={query.data.revision}
          title={t("policy")}
          message={t("policyHelp")}
          busy={save.isPending}
          error={save.error?.message}
          onCancel={() => setConfirming(false)}
          onConfirm={(ticket) =>
            save.mutate({
              slug,
              revision: query.data.revision,
              signature,
              ticket,
            })
          }
        >
          <Markdown>{document.body}</Markdown>
        </TimedActionDialog>
      )}
      <h2 className="section-title">{t("policy")}</h2>
      <p className="muted">{t("policyHelp")}</p>
      <article className="prose max-h-96 overflow-auto rounded-lg border border-slate-200 p-4">
        <Markdown>{document.body}</Markdown>
      </article>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (slug === "tutee-policy") setConfirming(true);
          else save.mutate({ slug, revision: query.data.revision, signature });
        }}
      >
        <label className="block">
          <span className="label">{t("signature")}</span>
          <input
            className="input w-full"
            required
            maxLength={120}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
        </label>
        <button className="btn-primary" disabled={save.isPending}>
          {t("accept")}
        </button>
        {save.error && <p role="alert">{save.error.message}</p>}
      </form>
    </section>
  );
}
