"use client";
import { useTranslations } from "next-intl";
import type { Selection } from "~/lib/user-filters";

/** Explicit include/exclude controls avoid ambiguous multi-select keyboard gestures. */
export function MultiFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: Selection;
  onChange: (value: Selection) => void;
}) {
  const t = useTranslations("userMultiFilters");
  return (
    <details className="relative min-w-48 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {label}
        <span className="ml-2 text-xs text-slate-500">
          {value.include.length + value.exclude.length || t("all")}
        </span>
      </summary>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">{label}</legend>
        <div className="grid grid-cols-[1fr_4rem_4rem] gap-2 text-xs text-slate-500">
          <span>{t("value")}</span>
          <span>{t("include")}</span>
          <span>{t("exclude")}</span>
        </div>
        {options.map((option) => (
          <div
            className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2 text-sm"
            key={option.value}
          >
            <span>{option.label}</span>
            {(["include", "exclude"] as const).map((mode) => (
              <input
                key={mode}
                type="checkbox"
                aria-label={`${t(mode)} ${option.label}`}
                checked={value[mode].includes(option.value)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [mode]: event.target.checked
                      ? [...value[mode], option.value]
                      : value[mode].filter((item) => item !== option.value),
                  })
                }
              />
            ))}
          </div>
        ))}
      </fieldset>
    </details>
  );
}
