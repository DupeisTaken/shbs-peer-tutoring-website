"use client";

import { useId, useMemo, useState } from "react";

export type CheckboxListboxOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
};

export type CheckboxListboxLabels = {
  selectedCount: (count: number) => string;
  clear: string;
  searchPlaceholder: string;
  searchLabel: string;
  selectedOnly: string;
  noMatches: string;
  removeItem: (label: string) => string;
  moreSelected: (count: number) => string;
};

const DEFAULT_LABELS: CheckboxListboxLabels = {
  selectedCount: (count) => `${count} selected`,
  clear: "Clear",
  searchPlaceholder: "Filter options…",
  searchLabel: "Filter options",
  selectedOnly: "Selected only",
  noMatches: "No options match this filter.",
  removeItem: (label) => `Remove ${label}`,
  moreSelected: (count) => `+${count} more`,
};

/**
 * Accessible multi-select listbox built on native checkboxes inside a bounded
 * scrollable container — replacing raw `<select multiple>` (which relies on
 * Ctrl/Cmd-click and renders unfocused selected rows as gray stripes).
 *
 * For long option sets (default >= 8 items), automatically enables local search,
 * a "Selected only" toggle, and a removable selected-items summary so hidden
 * selections stay visible and are never cleared by filtering.
 */
export function CheckboxListbox({
  label,
  options,
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  searchable,
  searchableThreshold = 8,
  maxVisibleSummary = 4,
  labels,
  className = "",
}: {
  label: string;
  options: CheckboxListboxOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Force search/selected-only controls on or off; defaults to `options.length >= searchableThreshold`. */
  searchable?: boolean;
  searchableThreshold?: number;
  maxVisibleSummary?: number;
  labels?: Partial<CheckboxListboxLabels>;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const searchId = useId();
  const copy = { ...DEFAULT_LABELS, ...labels };

  const selectedSet = useMemo(() => new Set(value), [value]);
  const showToolbar = searchable ?? options.length >= searchableThreshold;

  const selectedOptions = useMemo(() => {
    const byValue = new Map(options.map((opt) => [opt.value, opt]));
    return value
      .map((id) => byValue.get(id))
      .filter((opt): opt is CheckboxListboxOption => Boolean(opt));
  }, [options, value]);

  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return options.filter((opt) => {
      if (selectedOnly && !selectedSet.has(opt.value)) return false;
      if (!needle) return true;
      return (
        opt.label.toLocaleLowerCase().includes(needle) ||
        (opt.description?.toLocaleLowerCase().includes(needle) ?? false) ||
        (opt.group?.toLocaleLowerCase().includes(needle) ?? false)
      );
    });
  }, [options, query, selectedOnly, selectedSet]);

  const toggle = (optionValue: string) => {
    if (disabled) return;
    if (selectedSet.has(optionValue)) {
      onChange(value.filter((item) => item !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const visibleSummary = selectedOptions.slice(0, maxVisibleSummary);
  const overflowCount = Math.max(0, selectedOptions.length - visibleSummary.length);

  return (
    <fieldset
      disabled={disabled}
      aria-invalid={invalid ? "true" : undefined}
      aria-describedby={describedBy}
      className={`min-w-0 space-y-1.5 ${className}`}
    >
      <legend className="label">{label}</legend>

      <div
        className={`overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
          invalid
            ? "border-red-500 ring-1 ring-red-500/20"
            : disabled
              ? "border-slate-200 bg-slate-50"
              : "border-slate-300"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              role="status"
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                value.length > 0
                  ? "bg-accent-50 text-accent-800"
                  : "bg-slate-200/70 text-slate-600"
              }`}
            >
              {copy.selectedCount(value.length)}
            </span>
            {showToolbar && (
              <button
                type="button"
                aria-pressed={selectedOnly}
                disabled={disabled}
                onClick={() => setSelectedOnly((current) => !current)}
                className={`focus-visible:ring-accent-500 inline-flex min-h-11 items-center rounded-md border px-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-7 ${
                  selectedOnly
                    ? "border-accent-500 bg-accent-50 text-accent-800"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {copy.selectedOnly}
              </button>
            )}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange([]);
                setSelectedOnly(false);
              }}
              className="link inline-flex min-h-11 items-center px-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-7"
            >
              {copy.clear}
            </button>
          )}
        </div>

        {showToolbar && (
          <div className="border-b border-slate-200 bg-white px-2.5 py-2">
            <label htmlFor={searchId} className="sr-only">
              {copy.searchLabel}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              disabled={disabled}
              placeholder={copy.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              className="input control-compact w-full lg:min-h-8 lg:py-1"
            />
          </div>
        )}

        {showToolbar && selectedOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
            {visibleSummary.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                aria-label={copy.removeItem(opt.label)}
                onClick={() => toggle(opt.value)}
                className="bg-accent-50 text-accent-800 border-accent-200 hover:bg-accent-100 focus-visible:ring-accent-500 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-6"
              >
                <span className="min-w-0 truncate">{opt.label}</span>
                <span aria-hidden="true" className="shrink-0 text-slate-500">
                  ×
                </span>
              </button>
            ))}
            {overflowCount > 0 && (
              <span className="badge-slate text-xs">
                {copy.moreSelected(overflowCount)}
              </span>
            )}
          </div>
        )}

        <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto overscroll-contain">
          {visibleOptions.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">
              {copy.noMatches}
            </p>
          ) : (
            visibleOptions.map((opt, index) => {
              const checked = selectedSet.has(opt.value);
              const showGroup =
                Boolean(opt.group) &&
                opt.group !== visibleOptions[index - 1]?.group;
              return (
                <div key={opt.value}>
                  {showGroup && (
                    <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-slate-600 uppercase backdrop-blur-xs">
                      {opt.group}
                    </div>
                  )}
                  <label
                    className={`flex min-h-11 items-start gap-2.5 px-3 py-2 text-sm transition-colors lg:min-h-9 ${
                      disabled || opt.disabled
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer"
                    } ${
                      checked
                        ? "bg-accent-50/60 font-medium text-slate-900"
                        : "bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || opt.disabled}
                      onChange={() => toggle(opt.value)}
                      className="accent-accent-600 mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                    />
                    <span className="min-w-0 flex-1 break-words">
                      <span className="block leading-5">{opt.label}</span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })
          )}
        </div>
      </div>
    </fieldset>
  );
}
