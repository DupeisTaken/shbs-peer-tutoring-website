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
import { hashKey, QueryClientContext } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getSessionReadReceipts } from "~/lib/session-read-receipts";
import type { SessionReadQuery } from "~/lib/session-read-receipts";
import {
  clearOtherViewIdentities,
  readViewState,
  readViewStateSnapshot,
  removeViewState,
  viewStateKey,
  writeViewState,
} from "~/lib/session-view-state";
import type { ViewState } from "~/lib/session-view-state";

type ViewContext = { identity: string; pathname: string; verified: boolean };
const Context = createContext<ViewContext | null>(null);
/** Useful for URL adapters: defer restoring a remembered view until identity is verified. */
export const useSessionViewVerified = () => !!useContext(Context)?.verified;

type AccessQueryResult = {
  error?: unknown;
  data?: unknown;
  status?: string;
  isSuccess?: boolean;
  isFetching?: boolean;
  // Accepted for ordinary result compatibility; never used as authority clocks.
  dataUpdatedAt?: number;
  errorUpdatedAt?: number;
};

export type SessionAccessQuery = AccessQueryResult & (
  | { denialKey: string; queryKey: QueryKey }
  | { denialKey?: undefined; queryKey?: QueryKey }
);
type AccessFailure = {
  readonly order: number;
  readonly blocked?: WeakSet<Promise<unknown>>;
};
type AccessSlot = {
  readonly binding?: SessionReadQuery;
  readonly seenDenials: ReadonlySet<number>;
  readonly failure?: AccessFailure;
  readonly fallbackSeen: boolean;
  readonly fallbackQuery?: SessionReadQuery;
  readonly fallbackError?: WeakRef<object>;
};
export type SessionAccessAuthority = {
  readonly denied: boolean;
  readonly slots: ReadonlyMap<string, AccessSlot>;
  readonly client?: QueryClient;
};

/** Feature owners may retain this metadata above disposable row/read lifetimes. */
export const createSessionAccessAuthority = (): SessionAccessAuthority => ({
  denied: false,
  slots: new Map(),
});

const sameAccessSlot = (left: AccessSlot | undefined, right: AccessSlot) =>
  !!left && left.binding === right.binding &&
  left.seenDenials === right.seenDenials && left.failure === right.failure &&
  left.fallbackSeen === right.fallbackSeen &&
  left.fallbackQuery === right.fallbackQuery &&
  left.fallbackError === right.fallbackError;

function accessError(error: unknown): error is {
  data: { code: "FORBIDDEN" | "UNAUTHORIZED" };
} {
  if (typeof error !== "object" || error === null || !("data" in error)) return false;
  const data = error.data;
  return typeof data === "object" && data !== null && "code" in data &&
    (data.code === "FORBIDDEN" || data.code === "UNAUTHORIZED");
}

/** Pure reconciliation shared by the hook and already-owned imperative episodes.
 * The returned metadata contains no response/error copies or persisted input. */
export function reconcileSessionAccessDenied(
  authority: SessionAccessAuthority,
  queries: readonly SessionAccessQuery[],
  client?: QueryClient,
): SessionAccessAuthority {
  // A verified identity replaces its client. No previous client's receipt can
  // authorize this one; a missing provider never releases an existing episode.
  const previous = authority.client && client && authority.client !== client
    ? createSessionAccessAuthority()
    : authority;
  const receipts = client ? getSessionReadReceipts(client) : undefined;
  const slots = new Map(previous.slots);
  let changed = previous !== authority || (!!client && previous.client !== client);
  const put = (id: string, slot: AccessSlot) => {
    if (!sameAccessSlot(slots.get(id), slot)) {
      slots.set(id, slot);
      changed = true;
    }
  };
  const observe = (slot: AccessSlot, query: SessionReadQuery | undefined) => {
    const order = query && receipts ? receipts.read(query).denialOrder : 0;
    if (!order || slot.seenDenials.has(order)) return slot;
    return {
      ...slot,
      // Orders are client-local unique event IDs. A maximum would skip an
      // unseen older denial when the slot later visits another cached scope.
      seenDenials: new Set([...slot.seenDenials, order]),
      failure: !slot.failure || order > slot.failure.order
        ? { order }
        : slot.failure,
    };
  };
  // Reduce the previous exact Query before accepting a changed/default binding:
  // React can batch its denial and the input reset into a single publication.
  for (const [id, slot] of previous.slots) put(id, observe(slot, slot.binding));

  const current = new Map<string, {
    query: SessionReadQuery | undefined;
    ready: boolean;
  }>();
  let liveDenied = queries.some((query) => accessError(query.error));
  let allReady = true;
  for (const result of queries) {
    if (result.queryKey === undefined && result.denialKey === undefined) {
      allReady &&= !!result.isSuccess && !result.isFetching;
      continue;
    }
    const query = result.queryKey && client
      ? client.getQueryCache().find({ queryKey: result.queryKey, exact: true })
      : undefined;
    const id = result.denialKey !== undefined
      ? "named:" + result.denialKey
      : "fixed:" + (query?.queryHash ?? (client
        ? client.defaultQueryOptions({ queryKey: result.queryKey! }).queryHash
        : hashKey(result.queryKey!)));
    let slot = slots.get(id) ?? { seenDenials: new Set<number>(), fallbackSeen: false };
    slot = observe(slot, query);
    const history = query && receipts ? receipts.read(query) : undefined;
    const cacheError = query?.state.error;
    const cacheDenied = accessError(cacheError);
    const denied = accessError(result.error) || cacheDenied;
    liveDenied ||= denied;
    // A captured observer may lag a real successful cache read. Conceal for
    // that inconsistent descriptor, but do not fence the successful promise
    // again merely because its current data generation has changed.
    const fallbackError = cacheDenied
      ? cacheError
      : !query && accessError(result.error) ? result.error : undefined;
    if (fallbackError && (!slot.failure || !slot.fallbackSeen ||
      slot.fallbackQuery !== query || slot.fallbackError?.deref() !== fallbackError)) {
      const newlyRecorded = !!history?.denialOrder &&
        !previous.slots.get(id)?.seenDenials.has(history.denialOrder);
      if (!newlyRecorded) {
        // An initial/late-installed live error has no replayable cache event.
        // Capture once for this failure identity; data/status-only replacement
        // must not keep moving the fence over newly admitted recovery work.
        const blocked = new WeakSet<Promise<unknown>>();
        for (const cached of client?.getQueryCache().getAll() ?? []) {
          if (cached.promise) blocked.add(cached.promise);
        }
        slot = { ...slot, failure: { order: receipts?.getOrder() ?? 0, blocked } };
      }
      slot = { ...slot, fallbackSeen: true, fallbackQuery: query,
        fallbackError: new WeakRef(fallbackError) };
    }
    slot = { ...slot, binding: query ?? slot.binding };
    put(id, slot);
    // These bound tRPC callers use raw data, without select/placeholderData.
    // A receipt must not combine current cache data with an older observer's
    // successful domain projection. This comparison retains no payload copies.
    const ready = !!query && !!result.isSuccess && !result.isFetching &&
      result.status === query.state.status && result.data === query.state.data &&
      result.error === query.state.error && query.state.status === "success" &&
      query.state.fetchStatus === "idle";
    current.set(id, { query, ready });
    allReady &&= ready;
  }
  let failuresReady = true;
  let hasFailure = false;
  for (const [id, slot] of slots) {
    if (!slot.failure) continue;
    hasFailure = true;
    const binding = current.get(id);
    const proof = binding?.query && receipts
      ? receipts.read(binding.query).proof
      : undefined;
    failuresReady &&= !!binding?.ready && !!proof &&
      proof.order > slot.failure.order &&
      (proof.firstDenialFence === undefined || proof.firstDenialFence > slot.failure.order) &&
      !slot.failure.blocked?.has(proof.promise);
  }
  const recovered = allReady && failuresReady;
  const denied = liveDenied || ((previous.denied || hasFailure) && !recovered);
  if (!denied && recovered) {
    for (const [id, slot] of slots) {
      if (slot.failure) put(id, { ...slot, failure: undefined });
    }
  }
  if (!changed && denied === previous.denied) return previous;
  return { denied, slots, client: client ?? previous.client };
}

const noAccessSubscription = () => () => undefined;
const emptyAccessSnapshot = () => 0;

/** Conceal before commit; only proof for the exact newly admitted read releases
 * bound episodes. Ordinary unbound/dynamic readers keep their existing contract. */
export function useSessionAccessDenied(...queries: SessionAccessQuery[]) {
  const contextClient = useContext(QueryClientContext);
  const bound = queries.some((query) => query.queryKey !== undefined || query.denialKey !== undefined);
  const client = bound ? contextClient : undefined;
  const receipts = client ? getSessionReadReceipts(client) : undefined;
  useSyncExternalStore(
    receipts?.subscribe ?? noAccessSubscription,
    receipts?.getSnapshot ?? emptyAccessSnapshot,
    emptyAccessSnapshot,
  );
  const [authority, setAuthority] = useState(createSessionAccessAuthority);
  const next = reconcileSessionAccessDenied(authority, queries, client);
  if (next !== authority) setAuthority(next);
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
): [T, Dispatch<SetStateAction<T>>, (next: T) => void] {
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
      // Event/effect callers use committed options, captured before React queues
      // or replays the pure updater. Render callers use reconcileValue below.
      const { initialState, parse } = latest.current;
      setStored((previous) => {
        const current = previous.key === key ? previous.value : initialState;
        const proposed = typeof next === "function" ? next(current) : next;
        const parsed = parse(proposed);
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
  // Only for guarded reconciliation in the component that owns this hook.
  // Capture this render's allowlist before queuing a pure state update; no refs
  // or storage access may escape an abandoned render. Persistence stays above.
  const reconcileValue = (next: T) => {
    if (!enabled || !restoreReady) return;
    const parsed = options.parse(next);
    if (parsed === undefined) return;
    setStored((previous) => ({
      ...previous,
      key,
      value: parsed,
      explicit: true,
      persistence: "write",
    }));
  };
  return [value, setValue, reconcileValue];
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
