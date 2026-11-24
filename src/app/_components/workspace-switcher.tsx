import Link from "next/link";
import type { ReactNode } from "react";

import type {
  WorkspaceArea,
  WorkspaceSwitcherItem,
} from "~/lib/workspace-navigation";
import { BrandMark } from "./brand-mark";
import { DetailsAutoClose } from "./details-auto-close";
import { ChevronDownIcon } from "./icons";

function AreaIcon({ id }: { id: WorkspaceArea }): ReactNode {
  const cls = "h-4 w-4 shrink-0";
  switch (id) {
    case "management":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "tutor":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      );
    case "tutee":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case "crew":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      );
    case "translations":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 8 6 6" />
          <path d="m4 14 6-6 2-3" />
          <path d="M2 5h12" />
          <path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" />
          <path d="M14 18h6" />
        </svg>
      );
    case "home":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
        </svg>
      );
    case "help":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.5 9.2a2.5 2.5 0 0 1 4.9.8c0 1.6-2.4 2.1-2.4 3.5" />
          <circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/**
 * Brand + current-workspace selector `(PT Logo) Title ⌄`.
 * Clicking opens a clean dropdown listing only the OTHER areas this account is
 * authorized to enter (never leaking restricted workspaces or repeating the current area).
 * Built on native `<details>` + `DetailsAutoClose` so outside clicks, Escape, and link
 * navigation close it smoothly with zero hydration overhead.
 */
export function WorkspaceSwitcher({
  href,
  title,
  hideTitle = false,
  items,
  menuLabel,
  workspacesGroupLabel,
  generalGroupLabel,
}: {
  href: string;
  title: string;
  /** On Program Home, omit the title text beside the logo while keeping the switcher menu. */
  hideTitle?: boolean;
  items: WorkspaceSwitcherItem[];
  menuLabel: string;
  workspacesGroupLabel: string;
  generalGroupLabel: string;
}) {
  if (items.length === 0) {
    return (
      <Link
        href={href}
        title={title}
        aria-label={hideTitle ? title : undefined}
        className="focus-visible:ring-accent-500 flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1.5 text-xl font-bold tracking-tight text-slate-900 transition hover:bg-slate-100/80 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:shrink-0 lg:gap-2.5 lg:text-lg"
      >
        <BrandMark className="h-8 w-8" />
        {!hideTitle ? <span className="min-w-0 truncate">{title}</span> : null}
      </Link>
    );
  }

  const workspaceItems = items.filter((item) => item.group === "workspaces");
  const generalItems = items.filter((item) => item.group === "general");
  const sections = [
    ...(workspaceItems.length > 0
      ? [{ key: "workspaces", title: workspacesGroupLabel, items: workspaceItems }]
      : []),
    ...(generalItems.length > 0
      ? [{ key: "general", title: generalGroupLabel, items: generalItems }]
      : []),
  ];

  return (
    <details className="group relative min-w-0">
      <DetailsAutoClose />
      <summary
        aria-label={hideTitle ? `${title} — ${menuLabel}` : `${title} — ${menuLabel}`}
        title={menuLabel}
        className={`focus-visible:ring-accent-500 group-open:bg-accent-50 group-open:text-accent-800 group-open:ring-accent-200/80 flex min-h-11 min-w-0 cursor-pointer list-none items-center rounded-lg text-xl font-bold tracking-tight text-slate-900 transition hover:bg-slate-100/90 group-open:ring-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:shrink-0 lg:text-lg [&::-webkit-details-marker]:hidden ${
          hideTitle
            ? "gap-1.5 py-1 pr-2 pl-1"
            : "gap-2 py-1 pr-2.5 pl-1 lg:gap-2.5"
        }`}
      >
        <BrandMark className="h-8 w-8" />
        {!hideTitle ? <span className="min-w-0 truncate">{title}</span> : null}
        <ChevronDownIcon className="group-open:text-accent-600 h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-open:rotate-180" />
      </summary>

      <nav
        aria-label={menuLabel}
        className="popover-surface absolute left-0 z-30 mt-2 max-h-[calc(100dvh-5rem)] w-[min(15.5rem,calc(100vw-2rem))] overflow-y-auto p-1.5"
      >
        <div className="divide-y divide-slate-100">
          {sections.map((section) => (
            <div key={section.key} className="py-1 first:pt-0.5 last:pb-0.5">
              {sections.length > 1 ? (
                <p className="px-2.5 pt-1 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">
                  {section.title}
                </p>
              ) : null}
              <div className="grid gap-0.5">
                {section.items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    prefetch={false}
                    className="group/item focus-visible:ring-accent-500 flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:outline-hidden lg:min-h-9 lg:text-[13.5px]"
                  >
                    <span className="group-hover/item:bg-accent-50 group-hover/item:text-accent-700 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition">
                      <AreaIcon id={item.id} />
                    </span>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </details>
  );
}
