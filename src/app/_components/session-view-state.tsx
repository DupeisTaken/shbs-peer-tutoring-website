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
/** Useful for URL adapters: defer restoring a remembered view until identity is verified. */
export const useSessionViewVerified = () => !!useContext(Context)?.verified;

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
  /** Dynamic catalogs: wait for options before validating/restoring IDs. Unlike
   * denial, false leaves the saved choice intact and exposes only initialState. */
  restoreReady?: boolean;
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
  const restoreReady = options.restoreReady !== false;
  const active = !!context?.verified && context.identity !== "anonymous";
  const latest = useRef(options);
  latest.current = options;
  const [stored, setStored] = useState({ key, value: options.initialState });
  // Cached choices must satisfy today's allowlist, including removed modules/rooms.
  const parsed =
    restoreReady && stored.key === key
      ? options.parse(stored.value)
      : undefined;
  const invalid = restoreReady && stored.key === key && parsed === undefined;
  const value = enabled && parsed !== undefined ? parsed : options.initialState;
  useEffect(() => {
    if (!invalid || !key) return;
    try {
      removeViewState(window.sessionStorage, key);
    } catch {
      /* Optional storage. */
    }
    setStored({ key, value: latest.current.initialState });
  }, [invalid, key]);
  useEffect(() => {
    if (!key || !active) return;
    try {
      if (!enabled) {
        removeViewState(window.sessionStorage, key);
        return;
      }
      if (!restoreReady) return;
      const restored = latest.current.parse(
        readViewState(window.sessionStorage, key),
      );
      setStored({ key, value: restored ?? latest.current.initialState });
    } catch {
      /* State still works without browser storage. */
    }
  }, [key, active, enabled, restoreReady]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (!enabled || !restoreReady) return;
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
    [key, active, enabled, restoreReady],
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

/** Server pages can register their already-authorized, fully loaded shell. */
export function SessionPagePosition(props: SessionScrollOptions) {
  useSessionPageScroll(props);
  return null;
}

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
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const resize = () => setDesktop(window.innerWidth >= 1024);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!active || !ready || !enabled || desktop === null) return;
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
    let mutations: MutationObserver | undefined;
    let lastPosition: number | null = null;
    const persist = () => {
      if (restoring) return;
      lastPosition = Math.max(0, owner.scrollTop);
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
      mutations?.disconnect();
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
      if (restoring) return;
      // Keep the final measurement even if route teardown precedes the next frame.
      lastPosition = Math.max(0, owner.scrollTop);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(persist);
    };
    const eventOwner = pane ?? window;
    eventOwner.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    window.addEventListener("hashchange", gesture);
    for (const name of [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ] as const)
      window.addEventListener(name, gesture, { passive: true });
    if (restoring) {
      // Next performs its own scroll handling after commit. Retry on content size changes,
      // bounded to five seconds; no history.state or global scrollRestoration overrides.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(attempt);
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(attempt);
        observer.observe(owner);
        for (const child of Array.from(owner.children)) observer.observe(child);
      }
      // Fixed-height admin panes do not resize when rows arrive. Observe content
      // growth and new children only while the bounded recovery is running.
      mutations = new MutationObserver(() => {
        for (const child of Array.from(owner.children))
          observer?.observe(child);
        attempt();
      });
      mutations.observe(owner, { childList: true, subtree: true });
      timeout = setTimeout(() => {
        attempt();
        stop();
      }, 5000);
    }
    return () => {
      cancelAnimationFrame(frame);
      if (lastPosition !== null) {
        try {
          writeViewState(window.sessionStorage, key, lastPosition);
        } catch {
          /* Optional storage. */
        }
      }
      stop();
      eventOwner.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("hashchange", gesture);
      for (const name of [
        "wheel",
        "touchstart",
        "pointerdown",
        "keydown",
      ] as const)
        window.removeEventListener(name, gesture);
    };
  }, [identity, pathname, active, id, scope, ready, enabled, desktop]);
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
