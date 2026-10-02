"use client";

import { ChoiceButton } from "./ui/button";
import { useTranslations } from "next-intl";

/** Shared wording and touch target for current-work tutor lists. */
export function PastTutorsToggle({
  showPast,
  onChange,
}: {
  showPast: boolean;
  onChange: (showPast: boolean) => void;
}) {
  const t = useTranslations("pastTutors");
  return (
    <ChoiceButton selected={showPast} onClick={() => onChange(!showPast)}>
      {t(showPast ? "hide" : "show")}
    </ChoiceButton>
  );
}
