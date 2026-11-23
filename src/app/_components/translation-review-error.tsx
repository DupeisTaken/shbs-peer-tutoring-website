"use client";

import { useTranslations } from "next-intl";
import { TRANSLATION_PAGE_MISSING } from "~/lib/translation-review-errors";

/** Missing page recovery also applies to queued decisions in Management Actions. */
export function TranslationReviewError({ message }: { message?: string }) {
  const t = useTranslations("translationEditor");
  return (
    <>
      {message === TRANSLATION_PAGE_MISSING
        ? t("pageTarget.missingRecovery")
        : message}
    </>
  );
}
