"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { hasLatinName } from "~/lib/username";

/** An optional spelling suggestion, never a condition for enrollment or a request to rename. */
export function PreferredLatinName({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("identityUsername");
  const id = useId();
  if (!name.trim() || hasLatinName(name)) return null;
  return (
    <div className="space-y-1 sm:col-span-2">
      <label htmlFor={id} className="label">
        {t("preferredLatinName")}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={160}
        aria-describedby={`${id}-help`}
        autoComplete="off"
        className="input min-h-11 w-full lg:min-h-10"
      />
      <p id={`${id}-help`} className="muted text-sm">
        {t("preferredLatinHelp")}
      </p>
    </div>
  );
}
