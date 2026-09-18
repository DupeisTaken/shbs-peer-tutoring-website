"use client";

import { useRef, useState } from "react";
import { NavSidebarClient, type NavSection } from "./nav-sidebar-client";

/** Native dialog keeps focus inside the drawer, supports Escape and restores the opener.
 * The scroll container is below its close bar, so even the last menu item stays reachable. */
export function AdminMobileNavigation({
  sections,
  labels,
  embedded = false,
}: {
  embedded?: boolean;
  sections: NavSection[];
  labels: {
    title: string;
    open: string;
    close: string;
    collapse: string;
    expand: string;
  };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className={embedded ? "lg:hidden" : "px-4 pb-2 lg:hidden"}>
      <button
        className="btn-secondary h-11 w-11 p-0"
        aria-label={labels.open}
        title={labels.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        aria-label={labels.title}
        onClose={() => setOpen(false)}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-80 max-w-[calc(100vw-2rem)] border-0 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/40"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 p-4">
            <h2 className="font-semibold">{labels.title}</h2>
            <button
              className="btn-secondary btn-sm"
              onClick={() => dialog.current?.close()}
            >
              {labels.close}
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a"))
                dialog.current?.close();
            }}
          >
            <NavSidebarClient
              sections={sections}
              collapseAllLabel={labels.collapse}
              expandAllLabel={labels.expand}
              sticky={false}
            />
          </div>
        </div>
      </dialog>
    </div>
  );
}
