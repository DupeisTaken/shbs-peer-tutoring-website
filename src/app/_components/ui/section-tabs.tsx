"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Manual activation lets keyboard users inspect tabs without discarding an editor's draft. */
export function SectionTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  children,
  flush = false,
  renderLayout,
}: {
  label: string;
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  /** Fuse onto a Tier-2 masthead bottom border as a single-row scrollable rail on narrow screens. */
  flush?: boolean;
  /** Optional custom composition separating the masthead tablist from the Tier-3 tabpanel. */
  renderLayout?: (parts: {
    tablist: ReactNode;
    tabpanel: ReactNode;
  }) => ReactNode;
}) {
  const id = useId();
  const [focused, setFocused] = useState<T | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!flush) return;
    activeRef.current?.scrollIntoView?.({
      inline: "nearest",
      block: "nearest",
    });
  }, [flush, value]);

  const tablist = (
    <div
      role="tablist"
      aria-label={label}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(null);
      }}
      className={
        flush
          ? "-mx-1 -mb-px flex min-w-0 flex-nowrap gap-1 overflow-x-auto scroll-px-2 px-1 pt-0.5 pr-6 [scrollbar-width:none] lg:pr-1 [&::-webkit-scrollbar]:hidden"
          : "flex flex-wrap gap-1 border-b border-slate-200"
      }
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            id={`${id}-${item.value}`}
            aria-controls={`${id}-panel`}
            aria-selected={active}
            tabIndex={(focused ?? value) === item.value ? 0 : -1}
            onFocus={() => setFocused(item.value)}
            className={
              flush
                ? "section-tab control-compact mb-0 shrink-0 whitespace-nowrap focus-visible:ring-inset"
                : "section-tab control-compact"
            }
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
        );
      })}
    </div>
  );

  const tabpanel = (
    <div
      role="tabpanel"
      id={`${id}-panel`}
      aria-labelledby={`${id}-${value}`}
      tabIndex={0}
      className="focus-visible:outline-accent-500 min-w-0"
    >
      {children}
    </div>
  );

  if (renderLayout) return <>{renderLayout({ tablist, tabpanel })}</>;
  return (
    <div className="min-w-0 space-y-4">
      {tablist}
      {tabpanel}
    </div>
  );
}
