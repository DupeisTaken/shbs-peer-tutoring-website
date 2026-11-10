import type { QueryClient } from "@tanstack/react-query";

/** Query identity without imposing TanStack's invariant data/error generics. */
export interface SessionReadQuery {
  readonly queryHash: string;
  readonly promise?: Promise<unknown>;
  readonly state: {
    readonly status: string;
    readonly fetchStatus: string;
    readonly data?: unknown;
    readonly error?: unknown;
  };
}

export interface SessionReadProof {
  readonly order: number;
  readonly firstDenialFence: number | undefined;
  readonly promise: Promise<unknown>;
  readonly generation: symbol;
}

export interface SessionReadHistory {
  readonly denialOrder: number;
  readonly generation: symbol;
  readonly proof?: SessionReadProof;
}

export interface SessionReadReceipts {
  getSnapshot(this: void): number;
  subscribe(this: void, listener: () => void): () => void;
  getOrder(this: void): number;
  read(this: void, query: SessionReadQuery): SessionReadHistory;
}

type HistoryRecord = {
  readonly history: SessionReadHistory;
  readonly withoutProof: SessionReadHistory;
};

const installed = new WeakMap<QueryClient, SessionReadReceipts>();
const emptyHistory: SessionReadHistory = Object.freeze({
  denialOrder: 0,
  generation: Symbol("unobserved-session-read"),
});

function accessDenied(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const code = (data as { code?: unknown }).code;
  return code === "UNAUTHORIZED" || code === "FORBIDDEN";
}

/** Pure lookup: render-time readers must never install cache subscriptions. */
export function getSessionReadReceipts(
  client: QueryClient,
): SessionReadReceipts | undefined {
  return installed.get(client);
}

/** Install on a newly owned client before exposing it to query consumers. */
export function installSessionReadReceipts(
  client: QueryClient,
): SessionReadReceipts {
  const existing = installed.get(client);
  if (existing) return existing;

  const cache = client.getQueryCache();
  const records = new WeakMap<SessionReadQuery, HistoryRecord>();
  const firstDenialFences = new WeakMap<Promise<unknown>, number>();
  const observedStates = new WeakSet<object>();
  const listeners = new Set<() => void>();
  let order = 0;
  let revision = 0;

  const notify = () => {
    revision += 1;
    listeners.forEach((listener) => listener());
  };
  const eligible = (query: SessionReadQuery, proof: SessionReadProof) =>
    cache.get(query.queryHash) === query &&
    query.promise === proof.promise &&
    records.get(query)?.history.generation === proof.generation &&
    query.state.status === "success" &&
    query.state.fetchStatus === "idle";

  const receipts: SessionReadReceipts = Object.freeze({
    getSnapshot: () => revision,
    getOrder: () => order,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    read: (query: SessionReadQuery) => {
      const record = records.get(query);
      if (!record) return emptyHistory;
      const proof = record.history.proof;
      return proof && !eligible(query, proof)
        ? record.withoutProof
        : record.history;
    },
  });
  installed.set(client, receipts);

  cache.subscribe((event) => {
    const query: SessionReadQuery = event.query;
    if (event.type === "removed") {
      const previous = records.get(query)?.history ?? emptyHistory;
      const history: SessionReadHistory = Object.freeze({
        denialOrder: previous.denialOrder,
        generation: Symbol("removed-session-read"),
      });
      records.set(query, { history, withoutProof: history });
      order += 1;
      notify();
      return;
    }
    // Query creation/observer events may run during render. They neither prove
    // a read nor justify notifying external React stores.
    if (event.type !== "updated") return;
    // Observers run before the cache event. A nested cache write (even an
    // equal-reference write followed by invalidate) can reach us first. The
    // older outer success must not certify that already-replaced state.
    const superseded = observedStates.has(query.state);
    observedStates.add(query.state);
    const action = event.action;
    if (
      action.type !== "success" &&
      action.type !== "error" &&
      action.type !== "setState"
    ) {
      if (
        records.get(query)?.history.proof &&
        (action.type === "fetch" || action.type === "pause" || action.type === "continue")
      ) notify();
      return;
    }

    const eventOrder = ++order;
    const previous = records.get(query)?.history ?? emptyHistory;
    // Capture classification from the action, never mutable current query data.
    const denied = action.type === "error" && accessDenied(action.error);
    if (denied) {
      for (const current of cache.getAll()) {
        const promise = current.promise;
        // A retryer keeps its identity across joins, retries and pauses. Later
        // denials must not overwrite the earliest fence for that same work.
        if (promise && !firstDenialFences.has(promise)) {
          firstDenialFences.set(promise, eventOrder);
        }
      }
    }
    const history: SessionReadHistory = Object.freeze({
      denialOrder: denied ? eventOrder : previous.denialOrder,
      generation: Symbol("session-read-data-generation"),
    });
    // Even equal-reference manual updates and state replacement invalidate an
    // unused read proof; the caller's current domain projection may change.
    records.set(query, { history, withoutProof: history });

    if (
      action.type === "success" &&
      !action.manual &&
      !superseded &&
      action.data === event.query.state.data &&
      query.promise
    ) {
      const proof: SessionReadProof = Object.freeze({
        order: eventOrder,
        firstDenialFence: firstDenialFences.get(query.promise),
        promise: query.promise,
        generation: history.generation,
      });
      // An already-resolved old fetch may dispatch after a replacement retryer
      // was installed. Its event then exposes the replacement's promise. Wait
      // for that promise: its own success/error supersedes this candidate first.
      void proof.promise.then(() => {
        if (!eligible(query, proof)) return;
        const published: SessionReadHistory = Object.freeze({ ...history, proof });
        records.set(query, { history: published, withoutProof: history });
        // Publication changes subscribers' snapshot, not the original read order.
        notify();
      }, () => undefined);
    }
    notify();
  });

  return receipts;
}
