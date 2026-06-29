"use client";

import { useState } from "react";
import Link from "next/link";

import { Markdown } from "~/app/_components/markdown";
import { DisclosureIcon } from "~/app/_components/icons";

export type LandingSectionItem = {
  id: string;
  title: string;
  body: string;
  openByDefault: boolean;
  /** INLINE expands an accordion in place; PAGE links to its detail page. */
  mode: "INLINE" | "PAGE";
  slug: string | null;
  /** When set (admin preview only), the panel is hidden from the public — render a badge. */
  draftLabel?: string;
};

/**
 * The public landing-page accordion: admin-authored expandable panels (markdown bodies). Uses the
 * shared DisclosureIcon so the ▸/▾ gesture matches the rest of the app. Each panel's initial
 * open state comes from `openByDefault`; visitors can toggle freely.
 */
export function LandingSections({ sections }: { sections: LandingSectionItem[] }) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.openByDefault).map((s) => s.id)),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="divide-y divide-slate-100">
      {sections.map((s) => {
        // PAGE sections are a clickable row that navigates to the detail page.
        if (s.mode === "PAGE" && s.slug) {
          return (
            <li key={s.id}>
              <Link
                href={`/p/${s.slug}`}
                className="group flex w-full items-center gap-3 py-4 text-left"
              >
                <span className="flex-1 text-lg font-semibold text-slate-900">{s.title}</span>
                {s.draftLabel && <span className="badge-amber">{s.draftLabel}</span>}
                <span
                  aria-hidden
                  className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-accent-600"
                >
                  →
                </span>
              </Link>
            </li>
          );
        }
        const isOpen = open.has(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => toggle(s.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 py-4 text-left"
            >
              <DisclosureIcon open={isOpen} />
              <span className="text-lg font-semibold text-slate-900">{s.title}</span>
              {s.draftLabel && <span className="badge-amber">{s.draftLabel}</span>}
            </button>
            {isOpen && (
              <div className="pb-5 pl-7 text-sm leading-relaxed text-slate-600">
                <Markdown>{s.body}</Markdown>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
