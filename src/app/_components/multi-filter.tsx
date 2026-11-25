"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { ChevronDownIcon } from "~/app/_components/icons";
import type { Selection } from "~/lib/user-filters";

export type MultiFilterOption = {
  value: string;
  label: string;
};

export type ActiveFilterGroup = {
  id: string;
  label: string;
  options: MultiFilterOption[];
  value: Selection;
  onChange: (value: Selection) => void;
};

/**
 * Floating faceted filter picker built on native `<details>` + `DetailsAutoClose`.
 *
 * Include and Exclude act as a mutually exclusive filter mode over one list of
 * selected values: when nothing is selected in either mode, everything matches;
 * switching modes moves the current selection between `include` and `exclude`.
 */
export function MultiFilter({
  label,
  options,
  value,
  onChange,
  disabled = false,
  defaultOpen = false,
}: {
  label: string;
  options: MultiFilterOption[];
  value: Selection;
  onChange: (value: Selection) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("userMultiFilters");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [preferredMode, setPreferredMode] = useState<"include" | "exclude">(
    () =>
      value.exclude.length > 0 && value.include.length === 0
        ? "exclude"
        : "include",
  );
  const [alignRight, setAlignRight] = useState(false);

  // Derive active mode from value when populated so external updates (like Clear
  // filters or chip removal) stay in sync; fall back to local preference when empty.
  const mode: "include" | "exclude" =
    value.exclude.length > 0 && value.include.length === 0
      ? "exclude"
      : value.include.length > 0
        ? "include"
        : preferredMode;

  const selectedValues = mode === "exclude" ? value.exclude : value.include;
  const activeCount = selectedValues.length;
  const isExcludeMode = mode === "exclude";

  // `<fieldset disabled>` disables inputs/buttons, not `<details>`. Close and block
  // the disclosure explicitly when the parent disables the filter toolbar.
  useEffect(() => {
    if (disabled && detailsRef.current?.open) {
      detailsRef.current.open = false;
    }
  }, [disabled]);

  const handleToggle = () => {
    const details = detailsRef.current;
    if (!details) return;
    if (disabled && details.open) {
      details.open = false;
      return;
    }
    if (!details.open) return;

    // Flip horizontally to right-aligned on desktop/tablet when a left-aligned
    // popover would overflow the scroll pane or viewport edge.
    const rect = details.getBoundingClientRect();
    const container = details.closest("#admin-content");
    const rightBound = container
      ? container.getBoundingClientRect().right
      : window.innerWidth;
    setAlignRight(rect.left + 288 > rightBound - 8);
  };

  const switchMode = (nextMode: "include" | "exclude") => {
    setPreferredMode(nextMode);
    if (nextMode === mode) return;
    if (selectedValues.length === 0) return;
    onChange(
      nextMode === "exclude"
        ? { include: [], exclude: [...selectedValues] }
        : { include: [...selectedValues], exclude: [] },
    );
  };

  const toggleOption = (optionValue: string, checked: boolean) => {
    const nextSelected = checked
      ? selectedValues.includes(optionValue)
        ? selectedValues
        : [...selectedValues, optionValue]
      : selectedValues.filter((item) => item !== optionValue);
    onChange(
      mode === "exclude"
        ? { include: [], exclude: nextSelected }
        : { include: nextSelected, exclude: [] },
    );
  };

  return (
    <details
      ref={detailsRef}
      open={!disabled && defaultOpen ? true : undefined}
      onToggle={handleToggle}
      className="group max-w-full min-w-0 sm:relative"
    >
      <DetailsAutoClose />
      <summary
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className={`focus-visible:ring-accent-500 inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium tracking-[-0.01em] shadow-2xs transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 [&::-webkit-details-marker]:hidden ${
          disabled ? "pointer-events-none opacity-50" : ""
        } ${
          activeCount === 0
            ? "border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/80 hover:text-slate-900 group-open:border-slate-300 group-open:bg-slate-50"
            : isExcludeMode
              ? "border-red-200 bg-red-50/70 text-red-900 hover:border-red-300 hover:bg-red-50 group-open:border-red-300 group-open:ring-2 group-open:ring-red-500/15"
              : "border-accent-300/90 bg-accent-50/70 text-accent-900 hover:border-accent-400 hover:bg-accent-50 group-open:border-accent-400 group-open:ring-accent-500/15 group-open:ring-2"
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span
            className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums ${
              isExcludeMode
                ? "bg-red-100/90 text-red-800"
                : "bg-accent-100/90 text-accent-800"
            }`}
            title={`${t(mode)}: ${activeCount}`}
          >
            {isExcludeMode ? `−${activeCount}` : `+${activeCount}`}
          </span>
        )}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180 ${
            activeCount === 0
              ? "text-slate-400 group-hover:text-slate-600"
              : isExcludeMode
                ? "text-red-500"
                : "text-accent-600"
          }`}
        />
      </summary>

      <div
        className={`popover-surface absolute inset-x-0 z-30 mt-2 overflow-hidden sm:inset-x-auto sm:w-72 ${
          alignRight ? "sm:right-0 sm:left-auto" : "sm:left-0"
        }`}
      >
        <div className="border-b border-slate-100 p-2">
          <div
            role="group"
            aria-label={label}
            className="grid grid-cols-2 rounded-lg bg-slate-100/90 p-0.5 text-xs ring-1 ring-slate-200/70 ring-inset"
          >
            {(["include", "exclude"] as const).map((tab) => {
              const active = mode === tab;
              const isExcludeTab = tab === "exclude";
              return (
                <button
                  key={tab}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => switchMode(tab)}
                  className={`focus-visible:ring-accent-500 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 tracking-[-0.01em] transition-all duration-150 focus-visible:ring-2 focus-visible:outline-hidden lg:min-h-7 ${
                    active
                      ? isExcludeTab
                        ? "bg-white font-semibold text-red-700 shadow-xs ring-1 ring-slate-900/5"
                        : "text-accent-800 bg-white font-semibold shadow-xs ring-1 ring-slate-900/5"
                      : "font-medium text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {isExcludeTab ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className={`h-3 w-3 shrink-0 ${active ? "text-red-600" : "text-slate-400"}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    >
                      <path d="M3.75 8h8.5" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className={`h-3 w-3 shrink-0 ${active ? "text-accent-600" : "text-slate-400"}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3.5 8.25 6.5 11.25 12.5 4.75" />
                    </svg>
                  )}
                  <span>{t(tab)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <fieldset disabled={disabled} className="min-w-0">
          <legend className="sr-only">{label}</legend>
          <div className="max-h-[min(18rem,calc(100dvh-14rem))] space-y-0.5 overflow-y-auto overscroll-contain p-1.5">
            {options.map((option) => {
              const checked = selectedValues.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`group/toggle relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm tracking-[-0.01em] transition-colors duration-100 has-[:disabled]:cursor-not-allowed lg:min-h-8 ${
                    checked
                      ? isExcludeMode
                        ? "bg-red-50/75 font-medium text-red-950 ring-1 ring-red-200/60 ring-inset hover:bg-red-50"
                        : "bg-accent-50/75 ring-accent-200/60 hover:bg-accent-50 font-medium text-slate-950 ring-1 ring-inset"
                      : "text-slate-700 hover:bg-slate-100/70 hover:text-slate-950"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    aria-label={`${t(mode)} ${option.label}`}
                    checked={checked}
                    onChange={(event) =>
                      toggleOption(option.value, event.target.checked)
                    }
                  />
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 ${
                      isExcludeMode
                        ? checked
                          ? "border-red-600 bg-red-600 text-white shadow-xs peer-focus-visible:ring-red-500 forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]"
                          : "border-slate-300/90 bg-white text-transparent shadow-[0_1px_1px_rgba(15,23,42,0.04)] group-hover/toggle:peer-enabled:border-red-300 group-hover/toggle:peer-enabled:bg-red-50/70 group-hover/toggle:peer-enabled:text-red-500/60 peer-focus-visible:ring-red-500"
                        : checked
                          ? "peer-focus-visible:ring-accent-500 border-[var(--action-background)] bg-[var(--action-background)] text-white shadow-xs forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]"
                          : "group-hover/toggle:peer-enabled:border-accent-400 group-hover/toggle:peer-enabled:bg-accent-50/70 group-hover/toggle:peer-enabled:text-accent-600/60 peer-focus-visible:ring-accent-500 border-slate-300/90 bg-white text-transparent shadow-[0_1px_1px_rgba(15,23,42,0.04)]"
                    }`}
                  >
                    {isExcludeMode ? (
                      <svg
                        viewBox="0 0 16 16"
                        className={`h-3 w-3 ${checked ? "" : "forced-colors:hidden"}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      >
                        <path d="M3.75 8h8.5" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 16 16"
                        className={`h-3 w-3 ${checked ? "" : "forced-colors:hidden"}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3.5 8.25 6.5 11.25 12.5 4.75" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-5 break-words">
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {activeCount > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs">
            <span className="font-medium text-slate-500 tabular-nums">
              {t("selectedCount", { count: activeCount })}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ include: [], exclude: [] })}
              className="link inline-flex min-h-11 items-center px-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-7"
            >
              {t("resetFilter")}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Removable summary chips for active `MultiFilter` selections. Renders nothing
 * when no filters are active so the idle filter card stays compact.
 */
export function ActiveFilterChips({
  groups,
  disabled = false,
}: {
  groups: ActiveFilterGroup[];
  disabled?: boolean;
}) {
  const t = useTranslations("userMultiFilters");

  const chips = groups.flatMap((group) => {
    const labelByValue = new Map(
      group.options.map((option) => [option.value, option.label]),
    );
    const makeChip = (mode: "include" | "exclude", itemValue: string) => ({
      key: `${group.id}:${mode}:${itemValue}`,
      mode,
      groupLabel: group.label,
      optionLabel: labelByValue.get(itemValue) ?? itemValue,
      remove: () =>
        group.onChange({
          ...group.value,
          [mode]: group.value[mode].filter((item) => item !== itemValue),
        }),
    });
    return [
      ...group.value.include.map((item) => makeChip("include", item)),
      ...group.value.exclude.map((item) => makeChip("exclude", item)),
    ];
  });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const isExclude = chip.mode === "exclude";
        const chipSummary = isExclude
          ? `${t("exclude")} · ${chip.groupLabel}: ${chip.optionLabel}`
          : `${chip.groupLabel}: ${chip.optionLabel}`;
        return (
          <button
            key={chip.key}
            type="button"
            disabled={disabled}
            aria-label={t("removeFilter", { label: chipSummary })}
            onClick={chip.remove}
            className={`group/chip focus-visible:ring-accent-500 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs tracking-[-0.01em] transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-7 lg:py-0.5 ${
              isExclude
                ? "border-red-200/90 bg-red-50/75 text-red-950 hover:border-red-300 hover:bg-red-50 focus-visible:ring-red-500"
                : "border-accent-200/90 bg-accent-50/75 text-accent-950 hover:border-accent-300 hover:bg-accent-50"
            }`}
          >
            {isExclude && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
              />
            )}
            <span className="min-w-0 truncate">
              {isExclude && (
                <span className="font-medium text-red-700">
                  {t("exclude")} ·{" "}
                </span>
              )}
              <span className={isExclude ? "text-red-700" : "text-accent-700"}>
                {chip.groupLabel}:
              </span>{" "}
              <span className="font-medium">{chip.optionLabel}</span>
            </span>
            <span
              aria-hidden="true"
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                isExclude
                  ? "text-red-600 group-hover/chip:bg-red-200/70 group-hover/chip:text-red-900"
                  : "text-accent-600 group-hover/chip:bg-accent-200/70 group-hover/chip:text-accent-900"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-2.5 w-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}
