"use client";

import { useTranslations } from "next-intl";
import { RegistrationProgress } from "~/app/_components/registration-progress";

/** Submission, mailbox proof and account review are separate completion boundaries. */
export function SignupProgress({
  current,
  title,
  focusOnMount = false,
  busy = false,
}: {
  current: 0 | 1 | 2;
  title: string;
  focusOnMount?: boolean;
  busy?: boolean;
}) {
  const t = useTranslations("survey");
  return (
    <RegistrationProgress
      steps={[t("stepSubmit"), t("stepVerify"), t("stepReview")]}
      current={current}
      title={title}
      busy={busy}
      focusOnMount={focusOnMount}
    />
  );
}
