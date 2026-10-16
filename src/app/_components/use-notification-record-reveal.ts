"use client";

import { useEffect, useRef } from "react";

export type NotificationRecordArrival = {
  hash: string;
  pathname: string;
  sequence: number;
};

/** Feature adapters own authorization, lookup and committed filters. This waiter
 * owns only the incoming record's scroll/focus, never a remembered position or a
 * draft. DOM changes wake delayed mounts; no timer repeatedly pulls the viewport.
 * A gesture relinquishes an unfinished arrival even while its read is pending. */
export function useNotificationRecordReveal(
  arrival: NotificationRecordArrival | null,
  ready: boolean,
  onCancel: () => void,
) {
  const completed = useRef<NotificationRecordArrival | null>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    if (!arrival || completed.current?.sequence === arrival.sequence) return;
    let stopped = false;
    let observer: MutationObserver | undefined;
    const ownsLocation = () =>
      window.location.pathname === arrival.pathname &&
      window.location.hash === arrival.hash;
    const stop = () => {
      stopped = true;
      observer?.disconnect();
    };
    const abandon = () => {
      if (stopped) return;
      stop();
      completed.current = arrival;
      cancel.current();
    };
    const attempt = () => {
      if (stopped || !ready) return;
      if (!ownsLocation()) return abandon();
      const target = document.getElementById(arrival.hash.slice(1));
      // A hidden panel is not a committed destination. Its owning adapter must
      // select it first; MutationObserver covers a later mounted child as well.
      if (!target?.getClientRects().length) return;
      stop();
      completed.current = arrival;
      target.scrollIntoView({ block: "center" });
      // Programmatic record focus adds no sequential keyboard stop and does not
      // start a second scroll in either the document or desktop admin pane.
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    };
    const location = () => {
      if (!ownsLocation()) abandon();
    };
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"])
      window.addEventListener(name, abandon, { capture: true, passive: true });
    window.addEventListener("hashchange", location);
    window.addEventListener("popstate", location);
    if (ready) {
      observer = new MutationObserver(attempt);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      attempt();
    }
    return () => {
      stop();
      for (const name of ["wheel", "touchstart", "pointerdown", "keydown"])
        window.removeEventListener(name, abandon, true);
      window.removeEventListener("hashchange", location);
      window.removeEventListener("popstate", location);
    };
  }, [arrival, ready]);
}
