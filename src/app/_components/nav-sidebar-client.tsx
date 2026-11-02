"use client";

import { useId, useState, useSyncExternalStore } from "react";

import { NavLink } from "~/app/_components/nav-link";
import { DisclosureIcon } from "~/app/_components/icons";
import { Button } from "~/app/_components/ui/button";

export type NavSection = {
  key: string;
  title: string;
  items: { href: string; label: string; exact?: boolean }[];
};

const STORAGE_KEY = "adminNavCollapsed";
const STORAGE_CHANGED = "admin-nav-collapsed-changed";

function readCollapsedSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeCollapsed(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_CHANGED, onChange);
  };
}

function parseCollapsed(raw: string | null): Record<string, boolean> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => typeof entry === "boolean"),
    );
  } catch {
    return {};
  }
}

const serverCollapsedSnapshot = () => null;

/**
 * The admin/localization left nav, with collapsible groups + a collapse/expand-all toggle. Collapse
 * state persists in localStorage so it survives navigation. The server snapshot
 * keeps hydration expanded; the browser subscribes to the saved presentation.
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
  const stored = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsedSnapshot,
    serverCollapsedSnapshot,
  );
  const [localChoice, setLocalChoice] = useState<{
    source: string | null;
    value: Record<string, boolean>;
  } | null>(null);
  // A failed storage write still applies the user's choice in this mounted nav.
  const collapsed =
    localChoice?.source === stored ? localChoice.value : parseCollapsed(stored);
  const navId = useId();

  const persist = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore (private mode / quota)
    }
    setLocalChoice({ source: readCollapsedSnapshot(), value: next });
    window.dispatchEvent(new Event(STORAGE_CHANGED));
  };

  const toggle = (key: string) =>
    persist({ ...collapsed, [key]: !collapsed[key] });
  const allCollapsed =
    sections.length > 0 && sections.every((s) => collapsed[s.key]);
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
        const isCollapsed = !!collapsed[section.key];
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
