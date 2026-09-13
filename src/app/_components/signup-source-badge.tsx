"use client";
import { useTranslations } from "next-intl";
import { signupSourceLabel } from "~/lib/signup-request-groups";

/** Source is presentation only; the request state and priority remain separate. */
export function SignupSourceBadge({
  source,
}: {
  source: string | null | undefined;
}) {
  const t = useTranslations("workflow");
  return (
    <span className="badge-slate" title={t("sourceHelp")}>
      {t(signupSourceLabel(source))}
    </span>
  );
}
