"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  clearOtherViewIdentities,
  readViewState,
  readViewStateSnapshot,
  removeViewState,
  viewStateKey,
  writeViewState,
  viewAccessDenied,
} from "~/lib/session-view-state";
import type { ViewState } from "~/lib/session-view-state";

type ViewContext = { identity: string; pathname: string; verified: boolean };
const Context = createContext<ViewContext | null>(null);
/** Useful for URL adapters: defer restoring a remembered view until identity is verified. */
export const useSessionViewVerified = () => !!useContext(Context)?.verified;

/** Preserve an access failure across later transport errors. Only fresh successful
 * reads release it; callers also hide cached content while this is true. */
export function useSessionAccessDenied(
  ...queries: {
    error?: { data?: { code?: string } | null } | null;
    isSuccess?: boolean;
    isFetching?: boolean;
    dataUpdatedAt?: number;
    errorUpdatedAt?: number;
    /** Stable feature-owned read slot, opt in when denial resets its query input. */
    denialKey?: string;
  }[]
) {
  const [authority, setAuthority] = useState<{
    denied: boolean;
    failures: Record<string, number>;
  }>({ denied: false, failures: {} });
  const failures = { ...authority.failures };
  for (const query of queries) {
    if (query.denialKey && viewAccessDenied(query.error))
      failures[query.denialKey] = Math.max(
        failures[query.denialKey] ?? 0,
        query.errorUpdatedAt ?? query.dataUpdatedAt ?? 0,
      );
  }
  const denied = queries.some((query) => viewAccessDenied(query.error));
  const recovered = queries.every((query) => {
    const failedAt = query.denialKey ? (failures[query.denialKey] ?? 0) : 0;
    return (
      query.isSuccess &&
      !query.isFetching &&
      (query.dataUpdatedAt === undefined ||
        !failedAt ||
        query.dataUpdatedAt > failedAt)
    );
  });
  // Query-input resets opt into named read slots: an older cached scope cannot
  // release that denial. Other callers retain their existing recovery contract,
  // including dynamic query lists and unrelated catalogues that do not refetch.
  const next = {
    denied: denied || (!recovered && authority.denied),
    failures: denied || !recovered ? failures : {},
  };
  if (JSON.stringify(next) !== JSON.stringify(authority)) setAuthority(next);
  return next.denied;
}

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

const VIEW_STORAGE_EVENT = "shbs:view-state-change";
const emptyStorageSnapshot = () => null;
function subscribeViewStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(VIEW_STORAGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(VIEW_STORAGE_EVENT, notify);
  };
}
function subscribeViewport(notify: () => void) {
  window.addEventListener("resize", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("resize", notify);
    window.removeEventListener("popstate", notify);
  };
}
const readViewport = () =>
  JSON.stringify([window.location.pathname, window.innerWidth >= 1024]);

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
  // Events/effects use the latest committed parser; rendering uses options directly.
  useLayoutEffect(() => {
    latest.current = options;
  });
  const canRestore = !!key && active && enabled && restoreReady;
  const readSnapshot = useCallback(() => {
    if (!canRestore) return null;
    try {
      return readViewStateSnapshot(window.sessionStorage, key);
    } catch {
      return null;
    }
  }, [key, canRestore]);
  // Browser storage is an external source. The server snapshot stays empty so
  // hydration never renders another identity's remembered choice prematurely.
  const snapshot = useSyncExternalStore(
    subscribeViewStorage,
    readSnapshot,
    emptyStorageSnapshot,
  );
  type Selection = {
    key: string;
    value: T;
    explicit: boolean;
    enabled: boolean;
    restored: boolean;
    snapshot: string | null | undefined;
    persistence: "none" | "write" | "remove";
  };
  const initial: Selection = {
    key,
    value: options.initialState,
    explicit: false,
    enabled,
    restored: false,
    snapshot: null,
    persistence: enabled ? "none" : "remove",
  };
  const [stored, setStored] = useState(initial);
  let selection = stored.key === key ? stored : initial;
  if (!enabled) {
    selection = { ...initial, persistence: "remove" };
  } else if (
    canRestore &&
    (!selection.restored ||
      (snapshot !== null && selection.snapshot !== snapshot))
  ) {
    // An early explicit choice wins only within its original identity/path/scope.
    // An absent snapshot cannot erase a mounted selection: optional storage may
    // become unavailable or remove this entry after rejecting our normalized write.
    const deliberate = selection.explicit
      ? options.parse(selection.value)
      : undefined;
    let restored = options.parse(
      typeof snapshot === "string" ? JSON.parse(snapshot) : undefined,
    );
    if (deliberate !== undefined) restored = deliberate;
    let restoredValue = options.initialState;
    if (restored !== undefined) restoredValue = restored;
    selection = {
      ...selection,
      value: restoredValue,
      explicit: deliberate !== undefined,
      persistence:
        restored !== undefined
          ? "write"
          : snapshot === null
            ? "none"
            : "remove",
    };
  }
  selection = { ...selection, enabled, restored: canRestore, snapshot };
  if (enabled && restoreReady) {
    const parsed = options.parse(selection.value);
    if (parsed === undefined) {
      selection = {
        ...selection,
        value: options.initialState,
        explicit: false,
        persistence: "remove",
      };
    } else if (JSON.stringify(parsed) !== JSON.stringify(selection.value)) {
      // Drop removed catalogue IDs in memory too, so they cannot revive while
      // storage is unavailable or a long live search exceeds its size budget.
      selection = { ...selection, value: parsed, persistence: "write" };
    }
  }
  if (JSON.stringify(selection) !== JSON.stringify(stored))
    setStored(selection);
  const value =
    enabled && restoreReady ? selection.value : options.initialState;
  const serialized = JSON.stringify(selection.value);
  const persistence = selection.persistence;
  useEffect(() => {
    if (!key) return;
    try {
      if (persistence === "remove") removeViewState(window.sessionStorage, key);
      else if (persistence === "write" && active && enabled && restoreReady)
        writeViewState(window.sessionStorage, key, JSON.parse(serialized) as T);
      else return;
      window.dispatchEvent(new Event(VIEW_STORAGE_EVENT));
    } catch {
      /* Optional storage never takes ownership of the live selection. */
    }
  }, [key, active, enabled, restoreReady, persistence, serialized]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (!enabled || !restoreReady) return;
      setStored((previous) => {
        const current =
          previous.key === key ? previous.value : latest.current.initialState;
        const proposed = typeof next === "function" ? next(current) : next;
        const parsed = latest.current.parse(proposed);
        if (parsed === undefined) return previous;
        return {
          ...previous,
          key,
          value: parsed,
          explicit: true,
          persistence: "write",
        };
      });
    },
    [key, enabled, restoreReady],
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
  // A retained outgoing feature must not adopt a newly verified destination
  // pathname. A new mount or explicit feature ID establishes the next owner.
  const viewport = useSyncExternalStore(
    subscribeViewport,
    readViewport,
    emptyStorageSnapshot,
  );
  const [browserPath, desktop] =
    viewport === null
      ? ["", null]
      : (JSON.parse(viewport) as [string, boolean]);
  const [routeOwner, setRouteOwner] = useState(() => ({ id, pathname: "" }));
  const matchingPath = pathname && browserPath === pathname ? pathname : "";
  if (routeOwner.id !== id || (!routeOwner.pathname && matchingPath)) {
    setRouteOwner({ id, pathname: matchingPath });
  }
  const ownsRoute = routeOwner.id === id && routeOwner.pathname === pathname;
  useEffect(() => {
    if (
      !active ||
      !ready ||
      !enabled ||
      !ownsRoute ||
      desktop === null ||
      window.location.pathname !== pathname
    )
      return;
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
    const ownsLocation = () => window.location.pathname === pathname;
    const persist = () => {
      // Next can reset the destination viewport before passive effect teardown,
      // including before an already queued source-page persistence frame runs.
      if (!ownsLocation() || restoring) return;
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
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      if (timeout) clearTimeout(timeout);
    };
    const attempt = () => {
      if (!ownsLocation()) {
        stop();
        return;
      }
      if (!restoring || target === null) return;
      const height = pane ? pane.clientHeight : window.innerHeight;
      const maximum = Math.max(0, owner.scrollHeight - height);
      const desired = Math.min(target, maximum);
      // Browser rounding and our own scroll events must not form a feedback loop.
      if (Math.abs(owner.scrollTop - desired) > 1) owner.scrollTop = desired;
      if (maximum >= target) lastPosition = Math.max(0, owner.scrollTop);
    };
    // A user gesture always wins over recovery; never pull the viewport away from them.
    const gesture = () => {
      stop();
    };
    const onScroll = () => {
      if (!ownsLocation()) {
        stop();
        return;
      }
      if (restoring && target !== null) {
        const height = pane ? pane.clientHeight : window.innerHeight;
        const desired = Math.min(
          target,
          Math.max(0, owner.scrollHeight - height),
        );
        // Next may scroll after the target first fits. Keep the same bounded
        // recovery window and never persist that framework reset over the target.
        if (Math.abs(owner.scrollTop - desired) > 1) {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(attempt);
        }
        return;
      }
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
      // Next performs its own scroll handling after commit. Retry late resets/content changes,
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
  }, [
    identity,
    pathname,
    active,
    id,
    scope,
    ready,
    enabled,
    desktop,
    ownsRoute,
  ]);
  useEffect(() => {
    if (enabled || !context || !ownsRoute) return;
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
  }, [enabled, identity, pathname, id, scope, context, ownsRoute]);
}
