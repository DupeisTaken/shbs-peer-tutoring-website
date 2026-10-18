"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { FieldRequirement } from "./field-requirement";
import { Button, ChoiceButton } from "./ui/button";

/** A staged preference control shared with the gallery. Null stays distinct from
 * an explicit zero; the owning form retains all save/version/authority rules. */
export function WorkloadPreferenceChoices({
  value,
  disabled = false,
  onChange,
}: {
  value: number | null;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations("tutorWorkload");
  const helpId = useId();
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {t("preference")} <FieldRequirement state="optional" />
      </p>
      <div
        role="group"
        aria-label={t("choices")}
        aria-describedby={helpId}
        className="flex flex-wrap gap-2"
      >
        {[0, 1, 2, 3, 4].map((count) => (
          <ChoiceButton
            key={count}
            selected={value === count}
            disabled={disabled}
            onClick={() => onChange(count)}
          >
            {count}
          </ChoiceButton>
        ))}
      </div>
      <p id={helpId} className="muted text-xs">
        {t("zeroHelp")}
      </p>
      <p role="status" className="text-sm text-slate-700">
        {value === null ? t("unset") : t("draftPreference", { count: value })}
      </p>
      <Button
        disabled={disabled || value === null}
        onClick={() => onChange(null)}
      >
        {t("clear")}
      </Button>
    </div>
  );
}
