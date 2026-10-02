"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Destinations remain links: browser history, modifier-click and deep links
 * retain native behavior. Only local alternate panels use SectionTabs. */
export function SectionLinks({
  label,
  items,
  currentHref,
}: {
  label: string;
  items: { href: string; label: string }[];
  currentHref?: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 flex-wrap gap-1 border-b border-slate-200"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={
            (currentHref ?? pathname) === item.href ? "page" : undefined
          }
          className="section-tab control-compact inline-flex max-w-full items-center whitespace-normal"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
