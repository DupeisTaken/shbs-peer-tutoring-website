"use client";

import { useTranslations } from "next-intl";

/** Shared wording and touch target for current-work tutor lists. */
export function PastTutorsToggle({ showPast, onChange }: {
  showPast: boolean;
  onChange: (showPast: boolean) => void;
}) {
  const t = useTranslations("pastTutors");
  return <button type="button" className="btn-secondary btn-sm min-h-11 lg:min-h-8"
    aria-pressed={showPast} onClick={() => onChange(!showPast)}>
    {t(showPast ? "hide" : "show")}
  </button>;
}
