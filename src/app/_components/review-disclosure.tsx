"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Review content stays mounted: collapsing hides controls from keyboard access,
 * but never discards a note, changes a version, or dismisses an active decision. */
export function ReviewDisclosure({
  title,
  children,
  defaultOpen = true,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  busy?: boolean;
}) {
  const id = useId();
  const t = useTranslations("approvals.review");
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="min-w-0 border-t border-slate-200 pt-2">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          disabled={busy}
          className="link flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold lg:min-h-8"
          onClick={() => setOpen(!open)}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {title}
          </span>{" "}
          <span className="ml-auto shrink-0 text-xs font-normal whitespace-nowrap">
            {t(open ? "collapse" : "expand")}
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="space-y-4 pt-3">
        {children}
      </div>
    </section>
  );
}
