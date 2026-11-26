"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Destinations remain links: browser history, modifier-click and deep links
 * retain native behavior. Only local alternate panels use SectionTabs. */
export function SectionLinks({
  label,
  items,
  currentHref,
  flush = false,
}: {
  label: string;
  items: { href: string; label: string }[];
  currentHref?: string;
  /** Fuse onto a Tier-2 masthead bottom border as a single-row scrollable rail on narrow screens. */
  flush?: boolean;
}) {
  const pathname = usePathname();
  const activeHref = currentHref ?? pathname;
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!flush) return;
    activeRef.current?.scrollIntoView?.({
      inline: "nearest",
      block: "nearest",
    });
  }, [flush, activeHref]);
  return (
    <nav
      aria-label={label}
      className={
        flush
          ? "-mx-1 -mb-px flex min-w-0 flex-nowrap gap-1 overflow-x-auto scroll-px-2 px-1 pt-0.5 pr-6 [scrollbar-width:none] lg:pr-1 [&::-webkit-scrollbar]:hidden"
          : "flex min-w-0 flex-wrap gap-1 border-b border-slate-200"
      }
    >
      {items.map((item) => {
        const active = activeHref === item.href;
        return (
          <Link
            key={item.href}
            ref={active ? activeRef : undefined}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={
              flush
                ? "section-tab control-compact mb-0 inline-flex shrink-0 items-center whitespace-nowrap focus-visible:ring-inset"
                : "section-tab control-compact inline-flex max-w-full items-center whitespace-normal"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
