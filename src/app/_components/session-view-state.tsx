"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  clearOtherViewIdentities,
  readViewState,
  removeViewState,
  viewStateKey,
  writeViewState,
} from "~/lib/session-view-state";
import type { ViewState } from "~/lib/session-view-state";

type ViewContext = { identity: string; pathname: string; verified: boolean };
const Context = createContext<ViewContext | null>(null);

/** Reuses the existing live-session check. It performs no requests and stores no private DOM. */
export function SessionViewProvider({
  identity,
  pathname,
  verified,
  children,
}: ViewContext & { children: ReactNode }) {
  useEffect(() => {
    try {
      clearOtherViewIdentities(window.sessionStorage, identity);
    } catch {
      /* Optional storage. */
    }
  }, [identity]);
  const value = useMemo(
    () => ({ identity, pathname, verified }),
    [identity, pathname, verified],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export type SessionViewOptions<T extends ViewState> = {
  /** Stable feature ID; increment it when the stored schema changes. */
  id: string;
  initialState: T;
  /** Explicit allowlist/parser. Return undefined for unknown, removed or unauthorized choices. */
  parse: (value: unknown) => T | undefined;
  /** Current period and validated query context; never raw URL tokens or private search bodies. */
  scope?: string;
  /** False on authoritative denial/module removal. Loading is not denial. */
  enabled?: boolean;
};

/** Drop-in state for tabs/filters/sort/page only. URL choices belong in initialState + scope,
 * or should override the returned value in the owning feature. Never use for form drafts. */
export function useSessionViewState<T extends ViewState>(
  options: SessionViewOptions<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(Context);
  const key = context
    ? viewStateKey(
        context.identity,
        context.pathname,
        options.id,
        options.scope ?? "",
      )
    : "";
  const enabled = options.enabled !== false;
  const active = !!context?.verified && context.identity !== "anonymous";
  const latest = useRef(options);
  latest.current = options;
  const [stored, setStored] = useState({ key, value: options.initialState });
  const value =
    enabled && stored.key === key ? stored.value : options.initialState;
  useEffect(() => {
    if (!key || !active) return;
    try {
      if (!enabled) {
        removeViewState(window.sessionStorage, key);
        return;
      }
      const restored = latest.current.parse(
        readViewState(window.sessionStorage, key),
      );
      setStored({ key, value: restored ?? latest.current.initialState });
    } catch {
      /* State still works without browser storage. */
    }
  }, [key, active, enabled]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (!enabled) return;
      setStored((previous) => {
        const current =
          previous.key === key ? previous.value : latest.current.initialState;
        const proposed = typeof next === "function" ? next(current) : next;
        const parsed = latest.current.parse(proposed);
        if (parsed === undefined) return previous;
        if (key && active) {
          try {
            writeViewState(window.sessionStorage, key, parsed);
          } catch {
            /* Optional storage. */
          }
        }
        return { key, value: parsed };
      });
    },
    [key, active, enabled],
  );
  return [value, setValue];
}

export type SessionScrollOptions = {
  id: string;
  /** Include selected panel/filter/validated URL context and period where applicable. */
  scope?: string;
  ready: boolean;
  enabled?: boolean;
};

/** Register once in the authorized page. Desktop management owns #admin-content;
 * other layouts own document scroll. Dialogs, tables and sidebar scroll are excluded. */
export function useSessionPageScroll({
  id,
  scope = "",
  ready,
  enabled = true,
}: SessionScrollOptions) {
  const context = useContext(Context);
  const identity = context?.identity ?? "anonymous";
  const pathname = context?.pathname ?? "";
  const active = !!context?.verified && identity !== "anonymous";
  useEffect(() => {
    if (!active || !ready || !enabled) return;
    const desktop = window.innerWidth >= 1024;
    const pane = desktop ? document.getElementById("admin-content") : null;
    const owner = pane ?? document.scrollingElement ?? document.documentElement;
    const key = viewStateKey(
      identity,
      pathname,
      "scroll:" + id,
      scope + (desktop ? ":desktop" : ":mobile"),
    );
    let saved: unknown;
    try {
      saved = readViewState(window.sessionStorage, key);
    } catch {
      /* Optional storage. */
    }
    const target =
      typeof saved === "number" && saved >= 0
        ? Math.min(saved, 1_000_000)
        : null;
    let restoring = target !== null && !window.location.hash;
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    const persist = () => {
      if (restoring) return;
      try {
        writeViewState(
          window.sessionStorage,
          key,
          Math.max(0, owner.scrollTop),
        );
      } catch {
        /* Optional storage. */
      }
    };
    const stop = () => {
      restoring = false;
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
    };
    const attempt = () => {
      if (!restoring || target === null) return;
      const height = pane ? pane.clientHeight : window.innerHeight;
      const maximum = Math.max(0, owner.scrollHeight - height);
      owner.scrollTop = Math.min(target, maximum);
      if (maximum >= target) stop();
    };
    // A user gesture always wins over recovery; never pull the viewport away from them.
    const gesture = () => {
      stop();
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(persist);
    };
    const eventOwner = pane ?? window;
    eventOwner.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    for (const name of [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ] as const)
      window.addEventListener(name, gesture, { passive: true });
    if (restoring) {
      // Next performs its own scroll handling after commit. Retry on content size changes,
      // bounded to two seconds; no history.state or global scrollRestoration overrides.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(attempt);
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(attempt);
        observer.observe(owner);
        if (owner.firstElementChild) observer.observe(owner.firstElementChild);
      }
      timeout = setTimeout(() => {
        attempt();
        stop();
      }, 2000);
    }
    return () => {
      cancelAnimationFrame(frame);
      stop();
      eventOwner.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      for (const name of [
        "wheel",
        "touchstart",
        "pointerdown",
        "keydown",
      ] as const)
        window.removeEventListener(name, gesture);
    };
  }, [identity, pathname, active, id, scope, ready, enabled]);
  useEffect(() => {
    if (enabled || !context) return;
    for (const size of [":desktop", ":mobile"]) {
      try {
        removeViewState(
          window.sessionStorage,
          viewStateKey(identity, pathname, "scroll:" + id, scope + size),
        );
      } catch {
        /* Optional storage. */
      }
    }
  }, [enabled, identity, pathname, id, scope, context]);
}
