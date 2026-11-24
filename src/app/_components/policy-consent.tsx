"use client";
import { useContext, useEffect, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { trpcProcedureKey, trpcQueryKey } from "~/lib/trpc-query-key";
import { Markdown } from "./markdown";
import { api } from "~/trpc/react";
import { TimedActionDialog } from "./timed-action-dialog";
import { CurrentPolicyDialog } from "./current-policy-dialog";
import { Button } from "./ui/button";
import { StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";

/** The server verifies the revision again on acceptance and on participation mutations. */
export function PolicyConsent({
  slug,
  children,
}: {
  slug: "tutor-policy" | "tutee-policy";
  children?: React.ReactNode;
}) {
  const t = useTranslations("workflows");
  const recovery = useTranslations("workflow");
  const locale = useLocale();
  const queryClient = useContext(QueryClientContext);
  const [accessDenied, setAccessDenied] = useState(false);
  const query = api.student.policy.useQuery(
    { slug },
    { enabled: !accessDenied },
  );
  const denied = useSessionAccessDenied({
    ...query,
    isSuccess: query.isSuccess && !!query.data,
    queryKey: trpcQueryKey(api.student.policy, ["student", "policy"], { slug }),
  });
  if (accessDenied !== denied) setAccessDenied(denied);
  useEffect(() => {
    if (!denied || !queryClient) return;
    queryClient.removeQueries({
      queryKey: trpcProcedureKey(api.student.policy, ["student", "policy"]),
      exact: false,
    });
  }, [denied, queryClient]);
  const readUnavailable =
    denied || !!query.error || (query.isSuccess && !query.data);
  const [signature, setSignature] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [acceptedRevision, setAcceptedRevision] = useState<string | null>(null);
  const save = api.student.acceptPolicy.useMutation({
    onSuccess: (_result, variables) => {
      setAcceptedRevision(variables.revision);
      setConfirming(false);
      return query.refetch();
    },
  });
  const activeDocument = query.data
    ? (query.data.documents.find((d) => d.locale === locale) ??
      query.data.documents.find((d) => d.locale === "en") ??
      query.data.documents[0])
    : undefined;
  // A lost read, missing data, or missing document retires this review intent.
  // Dialog cleanup releases its ticket; read-only Refresh must not reopen it.
  if ((readUnavailable || !query.data || !activeDocument) && confirming)
    setConfirming(false);
  if (denied && viewing) setViewing(false);
  // Keep the reader open if a refresh finds a newly published, unaccepted revision.
  // Closing it reveals the ordinary consent flow; reading never records acceptance.
  const reader =
    viewing && !denied ? (
      <CurrentPolicyDialog
        documents={query.data?.documents}
        loading={query.isFetching}
        error={readUnavailable}
        onRetry={() => void query.refetch()}
        onClose={() => setViewing(false)}
      />
    ) : null;
  // Recovery only reads policy state. The signature remains owned above this
  // branch; unavailable evidence still cannot expose acceptance-gated children.
  if (readUnavailable && !viewing)
    return (
      <StatePanel
        kind={denied ? "denied" : "error"}
        title={recovery("policyLoadError")}
        action={
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {recovery("policyRefresh")}
          </Button>
        }
      >
        {query.error?.message}
      </StatePanel>
    );
  if (query.data?.accepted || viewing)
    return (
      <>
        {!readUnavailable &&
          query.data?.accepted &&
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
  if (!query.data) return <p>{t("loading")}</p>;
  const document = activeDocument;
  if (!document)
    return (
      <StatePanel
        kind="error"
        title={recovery("policyLoadError")}
        action={
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {recovery("policyRefresh")}
          </Button>
        }
      />
    );
  const alreadyAccepted = acceptedRevision === query.data.revision;
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
            save.mutateAsync({
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
          if (save.isPending || alreadyAccepted) return;
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
            disabled={save.isPending || alreadyAccepted}
            onChange={(e) => setSignature(e.target.value)}
          />
        </label>
        <button
          className="btn-primary"
          disabled={save.isPending || alreadyAccepted}
        >
          {t("accept")}
        </button>
        {save.error && <p role="alert">{save.error.message}</p>}
      </form>
    </section>
  );
}
