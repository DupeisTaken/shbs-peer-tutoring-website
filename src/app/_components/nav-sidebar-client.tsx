"use client";

import { useEffect, useId, useState } from "react";

import { NavLink } from "~/app/_components/nav-link";
import { DisclosureIcon } from "~/app/_components/icons";
import { Button } from "~/app/_components/ui/button";

export type NavSection = {
  key: string;
  title: string;
  items: { href: string; label: string; exact?: boolean }[];
};

const STORAGE_KEY = "adminNavCollapsed";

/**
 * The admin/localization left nav, with collapsible groups + a collapse/expand-all toggle. Collapse
 * state persists in localStorage so it survives navigation. Sections render expanded on first paint
 * (matching SSR) and apply the stored state after hydration, so there's no flash or mismatch.
 */
export function NavSidebarClient({
  sections,
  collapseAllLabel,
  expandAllLabel,
  sticky = true,
}: {
  sections: NavSection[];
  collapseAllLabel: string;
  expandAllLabel: string;
  sticky?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const navId = useId();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
  }, []);

  const persist = (next: Record<string, boolean>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore (private mode / quota)
    }
  };

  const toggle = (key: string) =>
    persist({ ...collapsed, [key]: !collapsed[key] });
  const allCollapsed =
    hydrated && sections.length > 0 && sections.every((s) => collapsed[s.key]);
  const setAll = (value: boolean) =>
    persist(Object.fromEntries(sections.map((s) => [s.key, value])));

  return (
    <nav className={sticky ? "sticky top-20 space-y-3" : "space-y-3"}>
      <Button
        variant="ghost"
        size="compact"
        className="link px-3 text-xs"
        onClick={() => setAll(!allCollapsed)}
      >
        {allCollapsed ? expandAllLabel : collapseAllLabel}
      </Button>
      {sections.map((section) => {
        const isCollapsed = hydrated && !!collapsed[section.key];
        // Desktop and drawer instances need distinct disclosure destinations.
        const sectionId = `${navId}-${section.key}`;
        return (
          <div key={section.key}>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => toggle(section.key)}
              aria-expanded={!isCollapsed}
              aria-controls={sectionId}
              className="w-full justify-start gap-1 px-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-700"
            >
              <DisclosureIcon open={!isCollapsed} />
              <span>{section.title}</span>
            </Button>
            <div id={sectionId} hidden={isCollapsed} className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  exact={item.exact}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
