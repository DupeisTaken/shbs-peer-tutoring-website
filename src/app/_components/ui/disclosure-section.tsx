"use client";

import { useState, type ReactNode } from "react";

/** Native keyboard behavior with an explicit child lifetime. Use retained for
 * drafts, lazy for query-only details, and mounted for existing creation forms. */
export function DisclosureSection({
  title,
  lifetime,
  children,
  defaultOpen = false,
}: {
  title: string;
  lifetime: "lazy" | "retained" | "mounted";
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(defaultOpen);
  const mounted =
    lifetime === "mounted" || open || (lifetime === "retained" && opened);
  return (
    <details
      open={open}
      className="min-w-0 rounded-lg border border-slate-200"
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (next) setOpened(true);
      }}
    >
      <summary className="focus-visible:ring-accent-500 min-h-11 cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none lg:min-h-8 lg:py-2">
        {title}
      </summary>
      {mounted && (
        <div className="min-w-0 border-t border-slate-100 p-4">{children}</div>
      )}
    </details>
  );
}
