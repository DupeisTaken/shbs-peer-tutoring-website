"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const DialogWork = createContext<{
  busy: boolean;
  register: (id: string) => () => void;
} | null>(null);

/** Register only this form's write. Returned busy also includes sibling/ancestor writes.
 * Keep independent forms mounted; their shared dialog cannot dismiss any active write. */
export function useDialogPending(pending: boolean): boolean {
  const context = useContext(DialogWork);
  const register = context?.register;
  const id = useId();
  useLayoutEffect(() => {
    if (pending) return register?.(id);
  }, [id, pending, register]);
  return pending || (context?.busy ?? false);
}

export function useDialogBusy(): boolean {
  return useContext(DialogWork)?.busy ?? false;
}

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
      el.closest("dialog") === dialog &&
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
        other.name === el.name &&
        other.form === el.form,
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

/** Shared native behavior, separate from layout: profile headers stay sticky and
 * readers keep their own scroll regions. Portals preserve React ownership. */
export function NativeDialog({
  children,
  onClose,
  busy = false,
  labelledBy,
  describedBy,
  className,
  closeOnBackdrop = false,
}: {
  children: ReactNode | ((busy: boolean) => ReactNode);
  onClose: () => void;
  busy?: boolean;
  labelledBy: string;
  describedBy?: string;
  className: string;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [writes, setWrites] = useState<ReadonlySet<string>>(() => new Set());
  const register = useCallback((id: string) => {
    setWrites((current) => new Set(current).add(id));
    return () =>
      setWrites((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
  }, []);
  // Propagate owned writes upward, never the inherited busy state (which would latch).
  const effectiveBusy = useDialogPending(busy || writes.size > 0);
  const context = useMemo(
    () => ({ busy: effectiveBusy, register }),
    [effectiveBusy, register],
  );
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const autofocus = dialog?.querySelector<HTMLElement>(
      "[data-dialog-autofocus]:not(:disabled)",
    );
    (autofocus ?? dialog)?.focus();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) {
        // A successful child write may close its review before parent refresh
        // finishes, or clear the required draft. A disabled opener cannot focus.
        const target = trigger.matches(":disabled")
          ? trigger.closest<HTMLDialogElement>("dialog")
          : trigger;
        target?.focus();
      }
    };
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    if (
      effectiveBusy &&
      active instanceof HTMLElement &&
      active.closest("dialog") === ref.current &&
      active.matches(":disabled")
    )
      ref.current?.focus();
  }, [effectiveBusy]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogWork.Provider value={context}>
      <dialog
        ref={ref}
        tabIndex={-1}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={effectiveBusy}
        onKeyDown={containFocus}
        onCancel={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!effectiveBusy) onClose();
        }}
        onClick={(event) => {
          if (
            closeOnBackdrop &&
            !effectiveBusy &&
            event.target === event.currentTarget
          )
            onClose();
        }}
        className={className}
      >
        {typeof children === "function" ? children(effectiveBusy) : children}
      </dialog>
    </DialogWork.Provider>,
    document.body,
  );
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
  const titleId = useId();
  const descriptionId = useId();
  return (
    <NativeDialog
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      busy={busy}
      onClose={onClose}
      className={`card fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto p-5 shadow-xl backdrop:bg-slate-900/50 ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {(effectiveBusy) => (
        <>
          <h2 id={titleId} className="section-title">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="muted mt-2">
              {description}
            </p>
          )}
          {children && <div className="my-4 min-w-0">{children}</div>}
          <fieldset
            disabled={effectiveBusy}
            className="mt-5 flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4"
          >
            {footer}
          </fieldset>
        </>
      )}
    </NativeDialog>
  );
}
