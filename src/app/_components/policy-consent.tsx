"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Markdown } from "./markdown";
import { api } from "~/trpc/react";
import { TimedActionDialog } from "./timed-action-dialog";

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
  const save = api.student.acceptPolicy.useMutation({
    onSuccess: () => query.refetch(),
  });
  if (query.error)
    return (
      <p role="alert" className="card p-6 text-red-700">
        {query.error.message}
      </p>
    );
  if (!query.data) return <p>{t("loading")}</p>;
  if (query.data.accepted)
    return (
      <>{children ?? <p className="text-emerald-700">{t("accepted")}</p>}</>
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
