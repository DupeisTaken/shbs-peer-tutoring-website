"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

/** Native modal dialogs trap focus, restore the trigger and escape table/scroll clipping. */
export function ProfileDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("accountProfile");
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Native modal inertness excludes the page, but a single-control dialog can
        // still tab into browser chrome. Wrap its visible controls explicitly.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 && (element.checkVisibility?.() ?? true),
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (
          first &&
          last &&
          ((event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last))
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      className="m-auto max-h-[min(88dvh,850px)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <h2 id={titleId} className="section-title">
          {title}
        </h2>
        <button
          type="button"
          className="btn-secondary btn-sm min-h-11 lg:min-h-8"
          onClick={onClose}
        >
          {t("close")}
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>,
    document.body,
  );
}
