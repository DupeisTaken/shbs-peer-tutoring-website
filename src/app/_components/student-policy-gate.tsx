"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Markdown } from "./markdown";
import { TimedActionDialog } from "./timed-action-dialog";
import { signOutAction } from "~/app/_actions/auth";

/** Check on entering authenticated pages and window focus; consent never alters priority. */
export function StudentPolicyGate() {
  const t = useTranslations("workflow");
  const path = usePathname();
  const publicPage = [
    "/",
    "/signup",
    "/signup/account",
    "/signin",
    "/suspended",
  ].includes(path);
  const status = api.studentWorkflow.policyStatus.useQuery(undefined, {
    enabled: !publicPage,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  if (status.error && !publicPage)
    return (
      <TimedActionDialog
        mandatory
        action="POLICY"
        target="policy-unavailable"
        title={t("policyTitle")}
        message={t("policyLoadError")}
        canConfirm={false}
        onCancel={() => void signOutAction()}
        onConfirm={() => undefined}
      >
        <button className="btn-secondary" onClick={() => void status.refetch()}>
          {t("retry")}
        </button>
      </TimedActionDialog>
    );
  return status.data && !publicPage ? (
    <PolicyPrompt key={status.data.revision} policy={status.data} />
  ) : null;
}
function PolicyPrompt({
  policy,
}: {
  policy: {
    revision: string;
    documents: { locale: string; title: string; body: string }[];
  };
}) {
  const t = useTranslations("workflow");
  const locale = useLocale();
  const utils = api.useUtils();
  const [agreed, setAgreed] = useState(false);
  const accept = api.studentWorkflow.acceptPolicy.useMutation({
    onSuccess: () => utils.studentWorkflow.policyStatus.invalidate(),
  });
  const doc =
    policy.documents.find((d) => d.locale === locale) ??
    policy.documents.find((d) => d.locale === "en")!;
  return (
    <TimedActionDialog
      mandatory
      action="POLICY"
      target={policy.revision}
      title={t("policyTitle")}
      message={t("policyConsequences")}
      canConfirm={agreed}
      busy={accept.isPending}
      error={accept.error?.message}
      onCancel={() => void signOutAction()}
      onConfirm={(ticket) =>
        accept.mutate({ revision: policy.revision, ticket, agreed: true })
      }
    >
      <div
        className="max-h-[40dvh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4"
        tabIndex={0}
      >
        <h3 className="mb-3 font-semibold">{doc.title}</h3>
        <Markdown>{doc.body}</Markdown>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        {t("policyAgree")}
      </label>
    </TimedActionDialog>
  );
}
