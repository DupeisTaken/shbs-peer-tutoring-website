"use client";
import { useEffect, useState } from "react";
import {
  confirmationState,
  type AnchoredConfirmation,
} from "~/lib/confirmation-timing";

/** The displayed state and the click-time guard read the same server-anchored clock.
 * Focus/visibility recovery handles throttled background callbacks without counting ticks. */
export function useConfirmationClock(anchor: AnchoredConfirmation | null) {
  const [sample, setSample] = useState(() => performance.now());
  useEffect(() => {
    if (!anchor) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const now = performance.now();
      setSample(now);
      const state = confirmationState(anchor, now);
      if (state.expired) return;
      const elapsed = Math.max(0, now - anchor.receivedAt);
      const untilReady =
        +anchor.ticket.readyAt - +anchor.ticket.serverNow - elapsed;
      const untilExpiry =
        +anchor.ticket.expiresAt -
        +anchor.ticket.serverNow -
        elapsed -
        Math.max(0, anchor.receivedAt - anchor.requestStartedAt);
      // Wake at exact label boundaries, then only at expiry after becoming eligible.
      const next = untilReady > 0 ? untilReady % 1_000 || 1_000 : untilExpiry;
      timer = setTimeout(tick, Math.max(1, Math.min(next, untilExpiry)));
    };
    tick();
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [anchor]);
  return {
    ...confirmationState(anchor, sample),
    read: () => confirmationState(anchor, performance.now()),
  };
}
