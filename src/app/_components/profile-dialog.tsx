"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { NativeDialog } from "./ui/modal";

/** Long profile surfaces share keyboard/pending behavior while keeping their wide
 * layout and visible Close header. Each independent child form owns its draft. */
export function ProfileDialog({
  title,
  onClose,
  children,
  size = "default",
  pending = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "default" | "wide";
  /** This owner's write; children register independent writes with useDialogPending. */
  pending?: boolean;
}) {
  const t = useTranslations("accountProfile");
  const titleId = useId();
  return (
    <NativeDialog
      labelledBy={titleId}
      busy={pending}
      onClose={onClose}
      className={`m-auto max-h-[min(88dvh,850px)] w-[calc(100%-2rem)] ${size === "wide" ? "max-w-4xl" : "max-w-2xl"} overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40`}
    >
      {(busy) => (
        <>
          <div
            className={`sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white py-4 ${size === "wide" ? "px-4 sm:px-6" : "px-5"}`}
          >
            <h2 id={titleId} className="section-title">
              {title}
            </h2>
            <button
              type="button"
              data-dialog-autofocus
              className="btn-secondary btn-sm min-h-11 lg:min-h-8"
              onClick={onClose}
              disabled={busy}
            >
              {t("close")}
            </button>
          </div>
          <div className={size === "wide" ? "p-4 sm:p-6" : "p-5"}>
            {children}
          </div>
        </>
      )}
    </NativeDialog>
  );
}
