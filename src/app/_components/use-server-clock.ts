"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Advance a server-reported instant using monotonic `performance.now()` deltas
 * and trigger a re-render only as each boundary instant is reached (plus on
 * window focus / visibility wake). Returns `undefined` when no server anchor is
 * supplied, avoiding false expiry against skewed client clocks or fixed tests.
 */
export function useServerBoundaryClock(
  serverNowMs: number | undefined,
  boundariesMs: readonly number[],
): number | undefined {
  const [clock, setClock] = useState<{
    anchor: number | undefined;
    elapsed: number;
  }>({ anchor: serverNowMs, elapsed: 0 });
  const origin = useRef<{ anchor: number; started: number } | null>(null);

  const currentNow =
    serverNowMs === undefined
      ? undefined
      : serverNowMs + (clock.anchor === serverNowMs ? clock.elapsed : 0);

  const nextBoundary =
    currentNow === undefined
      ? undefined
      : boundariesMs.reduce<number | undefined>(
          (earliest, boundary) =>
            boundary > currentNow &&
            (earliest === undefined || boundary < earliest)
              ? boundary
              : earliest,
          undefined,
        );

  useEffect(() => {
    if (serverNowMs === undefined) {
      origin.current = null;
      return;
    }
    if (origin.current?.anchor !== serverNowMs) {
      origin.current = { anchor: serverNowMs, started: performance.now() };
    }
    if (nextBoundary === undefined) return;
    const started = origin.current.started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer !== undefined) clearTimeout(timer);
      const elapsed = Math.max(0, performance.now() - started);
      const now = serverNowMs + elapsed;
      if (now >= nextBoundary) {
        setClock({ anchor: serverNowMs, elapsed });
        return;
      }
      timer = setTimeout(
        check,
        Math.min(Math.max(1, nextBoundary - now), 60_000),
      );
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [serverNowMs, nextBoundary]);

  return currentNow;
}
