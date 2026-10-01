"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/** Wrap Tab within visible enabled controls, respecting native radio-group tab stops. */
function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  // React portals retain their component ancestry. A nested dialog owns its
  // keyboard events even though they bubble through this parent's React handler.
  if (
    event.target instanceof Element &&
    event.target.closest("dialog") !== dialog
  )
    return;
  const candidates = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], summary, [tabindex]",
    ),
  ].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.matches('input[type="hidden"]') &&
      !el.closest("[hidden], [inert]") &&
      // An element can look visible in its own computed style while an ancestor hides it.
      (() => {
        for (
          let node: HTMLElement | null = el;
          node && node !== dialog;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden")
            return false;
        }
        const closedDetails = el.closest("details:not([open])");
        return (
          !closedDetails || closedDetails.querySelector("summary")?.contains(el)
        );
      })(),
  );
  const stops = candidates.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name)
      return true;
    const group = candidates.filter(
      (other): other is HTMLInputElement =>
        other instanceof HTMLInputElement &&
        other.type === "radio" &&
        other.name === el.name,
    );
    return el === (group.find((radio) => radio.checked) ?? group[0]);
  });
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  if (
    document.activeElement === dialog ||
    !dialog.contains(document.activeElement) ||
    (event.shiftKey && document.activeElement === first) ||
    (!event.shiftKey && document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** Native modality supplies an inert background. Callers own confirmation rules and mutations. */
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    // Opt-in focus goes to a reason field or the safe Cancel action, never a destructive action.
    (
      dialog?.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? dialog
    )?.focus();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    if (busy && active instanceof HTMLElement && active.matches(":disabled"))
      ref.current?.focus();
  }, [busy]);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy}
      onKeyDown={containFocus}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={`card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto p-5 shadow-xl backdrop:bg-slate-900/50 ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      <h2 id={titleId} className="section-title">
        {title}
      </h2>
      {description && (
        <p id={descriptionId} className="muted mt-2">
          {description}
        </p>
      )}
      {children && <div className="my-4 min-w-0">{children}</div>}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
        {footer}
      </div>
    </dialog>
  );
}
