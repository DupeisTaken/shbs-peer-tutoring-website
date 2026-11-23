import { afterEach, expect, it, vi } from "vitest";
import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryCache,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import {
  getSessionReadReceipts,
  installSessionReadReceipts,
} from "./session-read-receipts";

type Data = { label: string } | { label: number } | null;
type Key = readonly string[];
const mainKey = ["session-read-receipts", "main"] as const;
const denialKey = ["session-read-receipts", "denial"] as const;
const clients: QueryClient[] = [];

function makeClient(queryCache?: QueryCache) {
  const client = new QueryClient({
    queryCache,
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
    },
  });
  clients.push(client);
  return client;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function query(client: QueryClient, key: Key = mainKey) {
  const current = client.getQueryCache().find<Data, Error>({
    queryKey: key,
    exact: true,
  });
  if (!current) throw new Error("Expected query identity");
  return current;
}

function fetch(
  client: QueryClient,
  queryFn: () => Promise<Data>,
  key: Key = mainKey,
) {
  return client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 });
}

async function deny(
  client: QueryClient,
  code = "FORBIDDEN",
  key: Key = denialKey,
) {
  const error = Object.assign(new Error("Access denied"), { data: { code } });
  await expect(
    client.fetchQuery({
      queryKey: key,
      queryFn: () => Promise.reject(error),
      staleTime: 0,
      networkMode: "always",
    }),
  ).rejects.toBe(error);
  return error;
}

afterEach(() => {
  onlineManager.setOnline(true);
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

it("C01: pure lookup does not install a listener", () => {
  const client = makeClient();
  const subscribe = vi.spyOn(client.getQueryCache(), "subscribe");
  expect(getSessionReadReceipts(client)).toBeUndefined();
  expect(subscribe).not.toHaveBeenCalled();
});

it("C02: installation is idempotent for one client", () => {
  const client = makeClient();
  const subscribe = vi.spyOn(client.getQueryCache(), "subscribe");
  const ledger = installSessionReadReceipts(client);
  expect(installSessionReadReceipts(client)).toBe(ledger);
  expect(getSessionReadReceipts(client)).toBe(ledger);
  expect(subscribe).toHaveBeenCalledTimes(1);
});

it("C03: clients do not share query histories or event orders", async () => {
  const first = makeClient();
  const second = makeClient();
  const firstLedger = installSessionReadReceipts(first);
  const secondLedger = installSessionReadReceipts(second);
  await deny(first);
  await fetch(second, async () => ({ label: "Other client" }));
  expect(firstLedger.read(query(first, denialKey)).denialOrder).toBeGreaterThan(
    0,
  );
  expect(secondLedger.read(query(second)).denialOrder).toBe(0);
  expect(secondLedger.read(query(second)).proof).toBeDefined();
  expect(firstLedger.read(query(second)).proof).toBeUndefined();
});

it("C04: a real successful fetch publishes immutable scalar proof metadata", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const remote = vi.fn(async () => ({ label: "Read result" }));
  await fetch(client, remote);
  const history = ledger.read(query(client));
  expect(history.proof?.promise).toBe(query(client).promise);
  expect(history.proof?.firstDenialFence).toBeUndefined();
  expect(history.proof?.order).toBeGreaterThan(0);
  expect(history.proof?.generation).toBe(history.generation);
  expect(Object.isFrozen(history)).toBe(true);
  expect(Object.isFrozen(history.proof)).toBe(true);
  expect(Object.keys(history.proof ?? {}).sort()).toEqual([
    "firstDenialFence",
    "generation",
    "order",
    "promise",
  ]);
  expect(remote).toHaveBeenCalledTimes(1);
});

it("C05: adding a query with initial data neither proves a read nor notifies subscribers", () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const listener = vi.fn();
  const stop = ledger.subscribe(listener);
  const revision = ledger.getSnapshot();
  client.getQueryCache().build(client, {
    queryKey: mainKey,
    initialData: { label: "Initial data" },
  });
  expect(ledger.read(query(client)).proof).toBeUndefined();
  expect(ledger.getSnapshot()).toBe(revision);
  expect(ledger.getOrder()).toBe(0);
  expect(listener).not.toHaveBeenCalled();
  stop();
});

it("C06: manual cache seeding cannot manufacture fetch authority", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  client.setQueryData(mainKey, { label: "Seeded" });
  expect(ledger.read(query(client)).proof).toBeUndefined();
  await fetch(client, async () => ({ label: "Actual read" }));
  expect(ledger.read(query(client)).proof).toBeDefined();
});

it("C07: both authoritative error codes advance a retained denial order", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  const first = ledger.read(query(client)).denialOrder;
  await deny(client, "UNAUTHORIZED", mainKey);
  expect(ledger.read(query(client)).denialOrder).toBeGreaterThan(first);
  expect(ledger.read(query(client)).proof).toBeUndefined();
});

it("C08: any terminal error invalidates proof without inventing access denial", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await fetch(client, async () => ({ label: "Read result" }));
  const before = ledger.read(query(client));
  await expect(
    fetch(client, async () => {
      throw new Error("Transport unavailable");
    }),
  ).rejects.toThrow("Transport unavailable");
  const after = ledger.read(query(client));
  expect(after.generation).not.toBe(before.generation);
  expect(after.denialOrder).toBe(0);
  expect(after.proof).toBeUndefined();
});

it("C09: a read already running at denial retains that admission fence", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const held = deferred<Data>();
  const work = fetch(client, () => held.promise);
  const admitted = query(client).promise;
  await deny(client);
  const fence = ledger.read(query(client, denialKey)).denialOrder;
  held.resolve({ label: "Earlier work" });
  await work;
  const proof = ledger.read(query(client)).proof;
  expect(proof?.promise).toBe(admitted);
  expect(proof?.order).toBeGreaterThan(fence);
  expect(proof?.firstDenialFence).toBe(fence);
});

it("C10: work newly admitted after denial has no earlier fence", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client);
  const denial = ledger.read(query(client, denialKey)).denialOrder;
  await fetch(client, async () => ({ label: "Newly admitted" }));
  const proof = ledger.read(query(client)).proof;
  expect(proof?.order).toBeGreaterThan(denial);
  expect(proof?.firstDenialFence).toBeUndefined();
});

it("C11: joining earlier work after denial does not change its admission identity", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const held = deferred<Data>();
  const remote = vi.fn(() => held.promise);
  const first = fetch(client, remote);
  const admitted = query(client).promise;
  await deny(client);
  const denial = ledger.read(query(client, denialKey)).denialOrder;
  const joined = fetch(client, remote);
  expect(query(client).promise).toBe(admitted);
  expect(remote).toHaveBeenCalledTimes(1);
  held.resolve({ label: "Joined earlier read" });
  await Promise.all([first, joined]);
  expect(ledger.read(query(client)).proof?.firstDenialFence).toBe(denial);
});

it("C12: paused work remains fenced when resumed after denial", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  onlineManager.setOnline(false);
  const remote = vi.fn(async () => ({ label: "Resumed work" }));
  const work = fetch(client, remote);
  const current = query(client);
  const admitted = current.promise;
  expect(current.state.fetchStatus).toBe("paused");
  expect(remote).not.toHaveBeenCalled();
  await deny(client);
  const denial = ledger.read(query(client, denialKey)).denialOrder;
  onlineManager.setOnline(true);
  current.onOnline();
  await work;
  expect(current.promise).toBe(admitted);
  expect(remote).toHaveBeenCalledTimes(1);
  expect(ledger.read(current).proof?.firstDenialFence).toBe(denial);
});

it("C13: silent replacement changes admission even without another fetch action", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  client.setQueryData(mainKey, { label: "Existing data" });
  const current = query(client);
  const old = deferred<Data>();
  const replacement = deferred<Data>();
  const meta = {};
  let fetchActions = 0;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.query === current &&
      event.action.type === "fetch"
    ) {
      fetchActions += 1;
    }
  });
  const first = current.fetch(
    { queryKey: mainKey, queryFn: () => old.promise },
    { meta },
  );
  const admitted = current.promise;
  await deny(client);
  const second = current.fetch(
    { queryKey: mainKey, queryFn: () => replacement.promise },
    { meta, cancelRefetch: true },
  );
  expect(current.promise).not.toBe(admitted);
  expect(fetchActions).toBe(1);
  replacement.resolve({ label: "New work" });
  await Promise.all([first, second]);
  expect(ledger.read(current).proof?.promise).toBe(current.promise);
  expect(ledger.read(current).proof?.firstDenialFence).toBeUndefined();
  old.resolve({ label: "Ignored old transport" });
  stop();
});

it("C14: the first fence distinguishes an earlier slot from a later denial", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", ["first-denial"]);
  const first = ledger.read(query(client, ["first-denial"])).denialOrder;
  const held = deferred<Data>();
  const work = fetch(client, () => held.promise);
  await deny(client, "FORBIDDEN", ["second-denial"]);
  const second = ledger.read(query(client, ["second-denial"])).denialOrder;
  await deny(client, "UNAUTHORIZED", ["third-denial"]);
  held.resolve({ label: "Work between denials" });
  await work;
  const fence = ledger.read(query(client)).proof?.firstDenialFence;
  expect(fence).toBe(second);
  expect(fence).toBeGreaterThan(first);
});

it("C15: retries keep one retryer identity and publish only terminal success", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const remote = vi
    .fn<() => Promise<Data>>()
    .mockRejectedValueOnce(new Error("Retryable failure"))
    .mockResolvedValueOnce({ label: "Retry succeeded" });
  const work = client.fetchQuery({
    queryKey: mainKey,
    queryFn: remote,
    retry: 1,
    retryDelay: 0,
  });
  const admitted = query(client).promise;
  await work;
  expect(remote).toHaveBeenCalledTimes(2);
  expect(query(client).promise).toBe(admitted);
  expect(ledger.read(query(client)).denialOrder).toBe(0);
  expect(ledger.read(query(client)).proof?.promise).toBe(admitted);
});

it("C16: manual valid data cannot inherit a successful-null read's proof", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  await fetch(client, async () => null);
  const before = ledger.read(query(client));
  expect(before.proof).toBeDefined();
  client.setQueryData(mainKey, { label: "Manual valid data" });
  const after = ledger.read(query(client));
  expect(after.proof).toBeUndefined();
  expect(after.generation).not.toBe(before.generation);
  expect(after.denialOrder).toBe(before.denialOrder);
});

it("C17: same-reference and equal-value manual successes each invalidate proof", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  for (const equalCopy of [false, true]) {
    await fetch(client, async () => ({ label: "Same shape" }));
    const current = query(client);
    const data = current.state.data;
    const before = ledger.read(current);
    if (data === null) throw new Error("Expected synthetic object data");
    client.setQueryData(mainKey, equalCopy ? { ...data } : data);
    expect(current.state.data).toBe(data);
    expect(ledger.read(current).generation).not.toBe(before.generation);
    expect(ledger.read(current).proof).toBeUndefined();
  }
});

it("C18: real hydration replaces data generation without preserving proof", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  await fetch(client, async () => ({ label: 19 }));
  const current = query(client);
  const before = ledger.read(current);
  const donor = makeClient();
  // Hydration's own newer-data precondition is independent of receipt ordering.
  donor.setQueryData(
    mainKey,
    { label: "Hydrated valid data" },
    {
      updatedAt: current.state.dataUpdatedAt + 1,
    },
  );
  hydrate(client, dehydrate(donor));
  expect(current.state.data).toEqual({ label: "Hydrated valid data" });
  expect(ledger.read(current).generation).not.toBe(before.generation);
  expect(ledger.read(current).denialOrder).toBe(before.denialOrder);
  expect(ledger.read(current).proof).toBeUndefined();
});

it("C19: reset restores initial data without restoring read authority", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  client.getQueryCache().build(client, {
    queryKey: mainKey,
    initialData: { label: "Initial data" },
  });
  await deny(client, "FORBIDDEN", mainKey);
  await fetch(client, async () => null);
  const current = query(client);
  const before = ledger.read(current);
  current.reset();
  expect(current.state.data).toEqual({ label: "Initial data" });
  expect(ledger.read(current).generation).not.toBe(before.generation);
  expect(ledger.read(current).denialOrder).toBe(before.denialOrder);
  expect(ledger.read(current).proof).toBeUndefined();
});

it("C20: every setState invalidates proof even when data identity is unchanged", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await fetch(client, async () => ({ label: "Read result" }));
  const current = query(client);
  const before = ledger.read(current);
  const data = current.state.data;
  current.setState({ isInvalidated: current.state.isInvalidated });
  expect(current.state.data).toBe(data);
  expect(ledger.read(current).generation).not.toBe(before.generation);
  expect(ledger.read(current).proof).toBeUndefined();
});

it("C21: a nested manual success invalidates a pending null-read candidate", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  let armed = true;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual &&
      armed
    ) {
      armed = false;
      client.setQueryData(mainKey, { label: "Manual replacement" });
    }
  });
  await fetch(client, async () => null);
  expect(armed).toBe(false);
  expect(query(client).state.data).toEqual({ label: "Manual replacement" });
  expect(ledger.read(query(client)).proof).toBeUndefined();
  stop();
});

it("C22: a nested state replacement invalidates a pending malformed candidate", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  let armed = true;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual &&
      armed
    ) {
      armed = false;
      event.query.setState({ data: { label: "Replacement state" } });
    }
  });
  await fetch(client, async () => ({ label: 19 }));
  expect(armed).toBe(false);
  expect(query(client).state.data).toEqual({ label: "Replacement state" });
  expect(ledger.read(query(client)).proof).toBeUndefined();
  stop();
});

it("C23: resolved-old-fetch aliasing waits for the replacement's actual success", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  client.setQueryData(mainKey, { label: "Existing data" });
  const current = query(client);
  const old = deferred<Data>();
  const replacement = deferred<Data>();
  const replacementFn = vi.fn(() => replacement.promise);
  let replacementWork: Promise<Data> | undefined;
  void old.promise.then(() => {
    queueMicrotask(() => {
      replacementWork = current.fetch(
        { queryKey: mainKey, queryFn: replacementFn },
        { cancelRefetch: true },
      );
    });
  });
  const oldFn = vi.fn(() => old.promise);
  const oldWork = fetch(client, oldFn);
  const oldIdentity = current.promise;
  old.resolve({ label: "Old fulfilled result" });
  await oldWork;
  expect(oldFn).toHaveBeenCalledTimes(1);
  expect(replacementFn).toHaveBeenCalledTimes(1);
  expect(current.promise).not.toBe(oldIdentity);
  expect(current.state.data).toEqual({ label: "Old fulfilled result" });
  expect(ledger.read(current).proof).toBeUndefined();
  if (!replacementWork) throw new Error("Expected replacement work");
  replacement.resolve({ label: "Replacement completed" });
  await replacementWork;
  expect(current.state.data).toEqual({ label: "Replacement completed" });
  expect(ledger.read(current).proof?.promise).toBe(current.promise);
});

it("C24: replacement rejection never publishes an aliased old success", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  client.setQueryData(mainKey, { label: "Existing data" });
  const current = query(client);
  const old = deferred<Data>();
  const replacement = deferred<Data>();
  let replacementWork: Promise<Data | undefined> | undefined;
  void old.promise.then(() => {
    queueMicrotask(() => {
      replacementWork = current
        .fetch(
          { queryKey: mainKey, queryFn: () => replacement.promise },
          { cancelRefetch: true },
        )
        .catch(() => undefined);
    });
  });
  const oldWork = fetch(client, () => old.promise);
  old.resolve({ label: "Old fulfilled result" });
  await oldWork;
  expect(ledger.read(current).proof).toBeUndefined();
  if (!replacementWork) throw new Error("Expected replacement work");
  replacement.reject(new Error("Replacement failed"));
  await replacementWork;
  expect(current.state.status).toBe("error");
  expect(ledger.read(current).proof).toBeUndefined();
});

it("C25: a post-success terminal callback error invalidates its pending candidate", async () => {
  const failure = new Error("Post-read callback failed");
  const client = makeClient(
    new QueryCache({
      onSuccess: () => {
        throw failure;
      },
    }),
  );
  const ledger = installSessionReadReceipts(client);
  await expect(
    fetch(client, async () => ({ label: "Read result" })),
  ).rejects.toBe(failure);
  expect(query(client).state.status).toBe("error");
  expect(ledger.read(query(client)).proof).toBeUndefined();
  expect(ledger.read(query(client)).denialOrder).toBe(0);
});

it("C26: removal retains old-binding denial while invalidating pending and recreated authority", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  const old = query(client);
  const denial = ledger.read(old).denialOrder;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.query === old &&
      event.action.type === "success" &&
      !event.action.manual
    ) {
      client.getQueryCache().remove(old);
    }
  });
  await fetch(client, async () => ({ label: "Removed before publication" }));
  expect(ledger.read(old).denialOrder).toBe(denial);
  expect(ledger.read(old).proof).toBeUndefined();
  client.setQueryData(mainKey, { label: "New query identity" });
  expect(query(client)).not.toBe(old);
  expect(ledger.read(query(client)).denialOrder).toBe(0);
  expect(ledger.read(query(client)).proof).toBeUndefined();
  stop();
});

it("C27: proof publication notifies with a new revision but keeps the original order", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  const listener = vi.fn();
  const stop = ledger.subscribe(listener);
  let successOrder = 0;
  let successRevision = 0;
  const stopCache = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual
    ) {
      successOrder = ledger.getOrder();
      successRevision = ledger.getSnapshot();
      expect(ledger.read(event.query).proof).toBeUndefined();
    }
  });
  await fetch(client, async () => ({ label: "Read result" }));
  expect(ledger.read(query(client)).proof?.order).toBe(successOrder);
  expect(ledger.getOrder()).toBe(successOrder);
  expect(ledger.getSnapshot()).toBeGreaterThan(successRevision);
  const notified = listener.mock.calls.length;
  stop();
  client.setQueryData(mainKey, { label: "Manual later data" });
  expect(listener).toHaveBeenCalledTimes(notified);
  stopCache();
});

it("C28: an observer's manual valid replacement cannot inherit an outer null success", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  const denial = ledger.read(query(client)).denialOrder;
  const observer = new QueryObserver<Data, Error>(client, {
    queryKey: mainKey,
    enabled: false,
  });
  let armed = true;
  // Raw observers run before the outer updated event reaches cache listeners.
  const stop = observer.subscribe((result) => {
    if (
      !armed ||
      !result.isSuccess ||
      result.isFetching ||
      result.data !== null
    )
      return;
    armed = false;
    client.setQueryData(mainKey, {
      label: "Observer's manual valid replacement",
    });
  });
  try {
    await fetch(client, async () => null);
    expect(armed).toBe(false);
    expect(query(client).state.data).toEqual({
      label: "Observer's manual valid replacement",
    });
    expect(ledger.read(query(client)).denialOrder).toBe(denial);
    expect(ledger.read(query(client)).proof).toBeUndefined();
    await fetch(client, async () => ({ label: "Actual valid recovery" }));
    expect(ledger.read(query(client)).proof).toBeDefined();
  } finally {
    stop();
  }
});

it("C29: an observer's equal-reference manual write invalidates the outer success", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  const payload = { label: 19 };
  const observer = new QueryObserver<Data, Error>(client, {
    queryKey: mainKey,
    enabled: false,
  });
  let armed = true;
  const stop = observer.subscribe((result) => {
    if (
      !armed ||
      !result.isSuccess ||
      result.isFetching ||
      result.data !== payload
    )
      return;
    armed = false;
    client.setQueryData(mainKey, result.data);
  });
  try {
    await fetch(client, async () => payload);
    expect(armed).toBe(false);
    expect(query(client).state.data).toBe(payload);
    expect(ledger.read(query(client)).proof).toBeUndefined();
    await fetch(client, async () => ({ label: "Actual valid recovery" }));
    expect(ledger.read(query(client)).proof).toBeDefined();
  } finally {
    stop();
  }
});

it("C30: invalidation after an observer's equal-reference write cannot disguise replacement", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await deny(client, "FORBIDDEN", mainKey);
  const payload = { label: 19 };
  const observer = new QueryObserver<Data, Error>(client, {
    queryKey: mainKey,
    enabled: false,
  });
  let armed = true;
  const stop = observer.subscribe((result) => {
    if (
      !armed ||
      !result.isSuccess ||
      result.isFetching ||
      result.data !== payload
    )
      return;
    armed = false;
    client.setQueryData(mainKey, result.data);
    // This nonterminal action replaces the state object once more before the
    // original success reaches the ledger, while retaining the same data.
    query(client).invalidate();
  });
  try {
    await fetch(client, async () => payload);
    expect(armed).toBe(false);
    expect(query(client).state.data).toBe(payload);
    expect(query(client).state.isInvalidated).toBe(true);
    expect(ledger.read(query(client)).proof).toBeUndefined();
    await fetch(client, async () => ({ label: "Actual valid recovery" }));
    expect(ledger.read(query(client)).proof).toBeDefined();
  } finally {
    stop();
  }
});

it("C31: immutable error actions retain denial after an observer clears current error", async () => {
  const client = makeClient();
  const ledger = installSessionReadReceipts(client);
  await fetch(client, async () => ({ label: "Earlier successful read" }));
  const before = ledger.getOrder();
  const failure = Object.assign(new Error("Observer-hidden denial"), {
    data: { code: "FORBIDDEN" },
  });
  const observer = new QueryObserver<Data, Error>(client, {
    queryKey: mainKey,
    enabled: false,
  });
  let armed = true;
  const stop = observer.subscribe((result) => {
    if (!armed || !result.isError || result.error !== failure) return;
    armed = false;
    client.setQueryData(mainKey, { label: "Observer cleared current error" });
  });
  try {
    await expect(fetch(client, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(armed).toBe(false);
    expect(query(client).state.status).toBe("success");
    expect(query(client).state.error).toBeNull();
    expect(ledger.read(query(client)).denialOrder).toBeGreaterThan(before);
    expect(ledger.read(query(client)).proof).toBeUndefined();
  } finally {
    stop();
  }
});
