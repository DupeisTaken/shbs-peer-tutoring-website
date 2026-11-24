"use client";
import { useTranslations } from "next-intl";
import { ChevronDownIcon } from "~/app/_components/icons";
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
  const activeCount = value.include.length + value.exclude.length;
  return (
    <details className="group relative max-w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors hover:border-slate-300 [overflow-wrap:anywhere]">
      <summary className="focus-visible:ring-accent-500 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm text-sm font-medium text-slate-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 [&::-webkit-details-marker]:hidden">
        {label}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
          <span className="badge-slate text-xs">
            {activeCount || t("all")}
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 text-slate-500 transition-transform duration-150 group-open:rotate-180" />
        </span>
      </summary>
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">{label}</legend>
        {/* Flexible narrow tracks retain touch targets without a rem-based minimum
            forcing the entire page sideways when text is enlarged. */}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(44px,.5fr)_minmax(44px,.5fr)] gap-2 text-xs text-slate-500 lg:grid-cols-[minmax(0,1fr)_4rem_4rem]">
          <span>{t("value")}</span>
          <span>{t("include")}</span>
          <span>{t("exclude")}</span>
        </div>
        {options.map((option) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_minmax(44px,.5fr)_minmax(44px,.5fr)] items-center gap-2 text-sm lg:grid-cols-[minmax(0,1fr)_4rem_4rem]"
            key={option.value}
          >
            <span>{option.label}</span>
            {(["include", "exclude"] as const).map((mode) => (
              // The label provides a touch target without enlarging the checkbox artwork.
              <label
                key={mode}
                className="flex min-h-11 items-center lg:min-h-8"
              >
                <input
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
              </label>
            ))}
          </div>
        ))}
      </fieldset>
    </details>
  );
}
