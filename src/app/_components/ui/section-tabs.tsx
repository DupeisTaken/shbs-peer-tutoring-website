"use client";

import { useId, useState, type ReactNode } from "react";

/** Manual activation lets keyboard users inspect tabs without discarding an editor's draft. */
export function SectionTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  children,
}: {
  label: string;
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  const [focused, setFocused] = useState<T | null>(null);
  return (
    <div className="min-w-0 space-y-4">
      <div
        role="tablist"
        aria-label={label}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(null);
        }}
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${id}-${item.value}`}
            aria-controls={`${id}-panel`}
            aria-selected={value === item.value}
            tabIndex={(focused ?? value) === item.value ? 0 : -1}
            onFocus={() => setFocused(item.value)}
            className="section-tab control-compact"
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = items.findIndex(
                (candidate) => candidate.value === item.value,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        items.length) %
                      items.length;
              document.getElementById(`${id}-${items[next]!.value}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${value}`}
        tabIndex={0}
        className="focus-visible:outline-accent-500 min-w-0"
      >
        {children}
      </div>
    </div>
  );
}
