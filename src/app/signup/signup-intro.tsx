"use client";

import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Observe the form's existing poll without starting another request. A newly
 * restricted account must not retain instructions to submit and verify a form. */
export function SignupIntro() {
  const t = useTranslations();
  const options = api.tutee.signupOptions.useQuery(undefined, {
    enabled: false,
  });
  return options.data?.signupRestriction?.blocked ? null : (
    <p>{t("survey.intro")}</p>
  );
}
