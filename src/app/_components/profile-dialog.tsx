"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

/** Native modal dialogs trap focus, restore the trigger and escape table/scroll clipping. */
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
  /** Wider subject-choice rows opt in without changing existing profile dialogs. */
  size?: "default" | "wide";
  /** Creation workflows keep the dialog open until their in-flight write settles. */
  pending?: boolean;
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
      aria-busy={pending || undefined}
      onCancel={(event) => {
        // Prevent the native close as well as React unmounting while saving.
        event.preventDefault();
        if (!pending) onClose();
      }}
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
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        }
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
      className={`m-auto max-h-[min(88dvh,850px)] w-[calc(100%-2rem)] ${size === "wide" ? "max-w-4xl" : "max-w-2xl"} overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40`}
    >
      <div
        className={`sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white py-4 ${size === "wide" ? "px-4 sm:px-6" : "px-5"}`}
      >
        <h2 id={titleId} className="section-title">
          {title}
        </h2>
        <button
          type="button"
          className="btn-secondary btn-sm min-h-11 lg:min-h-8"
          onClick={onClose}
          disabled={pending}
        >
          {t("close")}
        </button>
      </div>
      <div className={size === "wide" ? "p-4 sm:p-6" : "p-5"}>{children}</div>
    </dialog>,
    document.body,
  );
}
