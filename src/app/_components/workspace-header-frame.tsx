"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const focusGap = 8;
type DocumentInset = {
  value: string;
  priority: string;
  applied: string;
  headers: Map<HTMLElement, number>;
};
const documentInsets = new WeakMap<Document, DocumentInset>();

/** Layout replacements can briefly overlap. Keep one original root style until
 * the last workspace header leaves, rather than restoring another header's inset. */
function registerDocumentInset(header: HTMLElement) {
  const doc = header.ownerDocument;
  const root = doc.documentElement;
  let inset = documentInsets.get(doc);
  if (!inset) {
    inset = {
      value: root.style.getPropertyValue("scroll-padding-top"),
      priority: root.style.getPropertyPriority("scroll-padding-top"),
      applied: "",
      headers: new Map(),
    };
    documentInsets.set(doc, inset);
  }
  const registration = inset;
  const apply = () => {
    registration.applied = `${Math.max(...registration.headers.values()) + focusGap}px`;
    root.style.setProperty("scroll-padding-top", registration.applied);
  };
  return {
    measure() {
      const height = header.getBoundingClientRect().height;
      if (registration.headers.get(header) === height) return false;
      registration.headers.set(header, height);
      apply();
      return true;
    },
    release() {
      registration.headers.delete(header);
      if (registration.headers.size) apply();
      else {
        // A different owner may have deliberately changed the root style.
        if (
          root.style.getPropertyValue("scroll-padding-top") ===
            registration.applied &&
          !root.style.getPropertyPriority("scroll-padding-top")
        ) {
          if (registration.value)
            root.style.setProperty(
              "scroll-padding-top",
              registration.value,
              registration.priority,
            );
          else root.style.removeProperty("scroll-padding-top");
        }
        documentInsets.delete(doc);
      }
    },
  };
}

/** Reveal only; never focus again from focusin. Native date inputs have internal
 * keyboard stops, and dialogs retain their own scroll and exact focus ownership. */
function revealWorkspaceFocus(header: HTMLElement, target: HTMLElement) {
  if (
    target !== document.activeElement ||
    !target.isConnected ||
    !header.parentElement?.contains(target) ||
    header.contains(target) ||
    target.closest("dialog, [hidden], [inert]") ||
    !target.getClientRects().length ||
    getComputedStyle(target).visibility === "hidden"
  )
    return;

  const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
  const owners: Array<HTMLElement | Window> = [];
  for (
    let parent = target.parentElement;
    parent && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    if (
      /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
    )
      owners.push(parent);
  }
  owners.push(window);
  for (const owner of owners) {
    const pane = owner instanceof HTMLElement ? owner : null;
    const paneBox = pane?.getBoundingClientRect();
    const visibleTop =
      Math.max(headerBottom, paneBox ? paneBox.top + pane!.clientTop : 0) +
      focusGap;
    const visibleBottom =
      Math.min(
        window.innerHeight,
        paneBox ? paneBox.top + pane!.clientTop + pane!.clientHeight : Infinity,
      ) - focusGap;
    // An inner pane entirely behind the header cannot reveal itself; its outer
    // owner must move the pane. Desktop management panes already begin below it.
    if (visibleBottom <= visibleTop) continue;
    const box = target.getBoundingClientRect();
    const available = visibleBottom - visibleTop;
    // Native Tab also visits large regions. Preserve their visible intersection
    // instead of pulling a retained tabpanel back to its beginning.
    if (
      box.height > available &&
      box.top < visibleBottom &&
      box.bottom > visibleTop
    )
      continue;
    const delta =
      box.top < visibleTop || box.height > available
        ? box.top - visibleTop
        : Math.max(0, box.bottom - visibleBottom);
    if (!delta) continue;
    const movement = pane
      ? Math.max(
          -pane.scrollTop,
          Math.min(
            delta,
            pane.scrollHeight - pane.clientHeight - pane.scrollTop,
          ),
        )
      : delta;
    if (movement) owner.scrollBy({ top: movement, behavior: "instant" });
    // A nested list can be visible in its own pane while still clipped by an
    // outer pane. Recheck each owner after the preceding movement has settled.
  }
}

/** Keep server-rendered header content and its sticky containing block intact. */
export function WorkspaceHeaderFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const inset = registerDocumentInset(header);
    let frame: number | null = null;
    const schedule = (target: EventTarget | null) => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (!(target instanceof HTMLElement) || target === document.body) return;
      // Native focus scrolling settles before this frame. CSS scroll padding
      // handles document navigation; this fallback corrects remaining occlusion.
      frame = requestAnimationFrame(() => {
        frame = null;
        revealWorkspaceFocus(header, target);
      });
    };
    const measure = () => {
      // A changed header can cover an already-focused native date host without
      // another focusin from its internal stops. Equal measurements do no work.
      if (inset.measure()) schedule(document.activeElement);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    const focused = (event: FocusEvent) => schedule(event.target);
    document.addEventListener("focusin", focused);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", focused);
      if (frame !== null) cancelAnimationFrame(frame);
      inset.release();
    };
  }, []);
  return (
    <header
      ref={ref}
      data-sticky-header
      className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white"
    >
      {children}
    </header>
  );
}
