import { afterEach, expect, it, vi } from "vitest";
import { dehydrate, hydrate } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getSessionReadReceipts } from "~/lib/session-read-receipts";
import { createQueryClient } from "~/trpc/query-client";
import {
  createSessionAccessAuthority,
  reconcileSessionAccessDenied,
} from "./session-view-state";
import type { SessionAccessQuery } from "./session-view-state";

type ReadData = { label: string } | { label: number } | null;
type ReadError = Error & { data?: { code?: string } };
type Key = readonly string[];
const clients: QueryClient[] = [];
const key = (scope: string) => ["session-access-authority", scope] as const;

function makeClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  clients.push(client);
  return client;
}

function currentQuery(client: QueryClient, queryKey: Key) {
  const query = client.getQueryCache().find<ReadData, ReadError>({
    queryKey,
    exact: true,
  });
  if (!query) throw new Error("Expected an actual cached query");
  return query;
}

function receipts(client: QueryClient) {
  const ledger = getSessionReadReceipts(client);
  if (!ledger)
    throw new Error("Expected the production factory's receipt ledger");
  return ledger;
}

function descriptor(
  client: QueryClient,
  queryKey: Key,
  denialKey = "private",
): SessionAccessQuery {
  const { state } = currentQuery(client, queryKey);
  // Project only actual Query state, including the same domain validation used
  // by callers that require a non-null DTO. No observer flags are fabricated.
  return {
    data: state.data,
    error: state.error,
    status: state.status,
    isSuccess:
      state.status === "success" &&
      state.data != null &&
      typeof state.data.label === "string",
    isFetching: state.fetchStatus === "fetching",
    queryKey,
    denialKey,
  };
}

function fetchRead(
  client: QueryClient,
  queryKey: Key,
  queryFn: () => Promise<ReadData>,
) {
  return client.fetchQuery<ReadData, ReadError>({
    queryKey,
    queryFn,
    staleTime: 0,
  });
}

async function deny(client: QueryClient, queryKey: Key) {
  const failure = Object.assign(new Error("Synthetic access denial"), {
    data: { code: "FORBIDDEN" },
  });
  await expect(
    fetchRead(client, queryKey, () => Promise.reject(failure)),
  ).rejects.toBe(failure);
  return failure;
}

async function hydrateDenied(client: QueryClient, queryKey: Key) {
  const donor = makeClient();
  const failure = await deny(donor, queryKey);
  hydrate(client, dehydrate(donor, { shouldDehydrateQuery: () => true }));
  expect(currentQuery(client, queryKey).state.error).toBe(failure);
  expect(
    receipts(client).read(currentQuery(client, queryKey)).denialOrder,
  ).toBe(0);
  return failure;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

it("detects an unseen older denial after a later scope has genuinely recovered", async () => {
  const client = makeClient();
  const a = key("a");
  const b = key("b");
  await deny(client, b);
  const bDenial = receipts(client).read(currentQuery(client, b)).denialOrder;
  client.setQueryData(b, { label: "Manual B data" });
  await fetchRead(client, a, async () => ({ label: "Initial A read" }));
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(false);
  await deny(client, a);
  expect(
    receipts(client).read(currentQuery(client, a)).denialOrder,
  ).toBeGreaterThan(bDenial);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(true);
  await fetchRead(client, a, async () => ({ label: "Genuine A recovery" }));
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(false);

  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b)],
    client,
  );
  expect(authority.denied).toBe(true);
  expect(receipts(client).read(currentQuery(client, b)).proof).toBeUndefined();
  expect(
    reconcileSessionAccessDenied(authority, [descriptor(client, b)], client),
  ).toBe(authority);
  const remote = vi.fn(async () => ({ label: "Genuine B recovery" }));
  await fetchRead(client, b, remote);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b)],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(remote).toHaveBeenCalledTimes(1);
});

it("does not resurrect a consumed denial when returning to manually updated data", async () => {
  const client = makeClient();
  const a = key("consumed-a");
  const b = key("consumed-b");
  await deny(client, a);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, a)],
    client,
  );
  const remote = vi.fn(async () => ({ label: "Accepted A recovery" }));
  await fetchRead(client, a, remote);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(false);
  await fetchRead(client, b, async () => ({ label: "Other successful scope" }));
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b)],
    client,
  );
  expect(authority.denied).toBe(false);

  client.setQueryData(a, { label: "Manual change after consumed recovery" });
  expect(receipts(client).read(currentQuery(client, a)).proof).toBeUndefined();
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(remote).toHaveBeenCalledTimes(1);
});

it("conceals a stale error descriptor without fencing the current successful promise again", async () => {
  const client = makeClient();
  const queryKey = key("stale-error");
  await deny(client, queryKey);
  const capturedError = descriptor(client, queryKey);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [capturedError],
    client,
  );
  const remote = vi.fn(async () => ({ label: "Current successful read" }));
  await fetchRead(client, queryKey, remote);
  const proof = receipts(client).read(currentQuery(client, queryKey)).proof;
  expect(proof).toBeDefined();

  const stale = reconcileSessionAccessDenied(
    authority,
    [capturedError],
    client,
  );
  expect(stale.denied).toBe(true);
  authority = reconcileSessionAccessDenied(
    stale,
    [descriptor(client, queryKey)],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(receipts(client).read(currentQuery(client, queryKey)).proof).toBe(
    proof,
  );
  expect(remote).toHaveBeenCalledTimes(1);
});

it("captures an initial hydrated error once and fences only work already exposed then", async () => {
  const client = makeClient();
  const initial = key("hydrated-initial");
  const pendingKey = key("hydrated-pending");
  await hydrateDenied(client, initial);
  const held = deferred<ReadData>();
  const remote = vi.fn<() => Promise<ReadData>>(() => held.promise);
  const pending = fetchRead(client, pendingKey, remote);
  void pending.catch(() => undefined);
  const admitted = currentQuery(client, pendingKey).promise;
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, initial)],
    client,
  );
  expect(authority.denied).toBe(true);
  await fetchRead(client, key("unrelated"), async () => ({
    label: "Unrelated read",
  }));
  expect(
    reconcileSessionAccessDenied(
      authority,
      [descriptor(client, initial)],
      client,
    ),
  ).toBe(authority);
  expect(currentQuery(client, pendingKey).promise).toBe(admitted);

  held.resolve({ label: "Work admitted before fallback" });
  await pending;
  expect(
    receipts(client).read(currentQuery(client, pendingKey)).proof,
  ).toBeDefined();
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, pendingKey)],
    client,
  );
  expect(authority.denied).toBe(true);
  remote.mockResolvedValueOnce({ label: "Work admitted after fallback" });
  await fetchRead(client, pendingKey, remote);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, pendingKey)],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(remote).toHaveBeenCalledTimes(2);
});

it("does not move an initial-error fence when setState retains the same denied error", async () => {
  const client = makeClient();
  const initial = key("same-error-initial");
  const recovery = key("same-error-recovery");
  const failure = await hydrateDenied(client, initial);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, initial)],
    client,
  );
  expect(authority.denied).toBe(true);
  const held = deferred<ReadData>();
  const remote = vi.fn(() => held.promise);
  const pending = fetchRead(client, recovery, remote);
  void pending.catch(() => undefined);
  const initialQuery = currentQuery(client, initial);
  const generation = receipts(client).read(initialQuery).generation;
  initialQuery.setState({ isInvalidated: !initialQuery.state.isInvalidated });
  expect(initialQuery.state.error).toBe(failure);
  expect(receipts(client).read(initialQuery).generation).not.toBe(generation);
  expect(
    reconcileSessionAccessDenied(
      authority,
      [descriptor(client, initial)],
      client,
    ),
  ).toBe(authority);

  held.resolve({ label: "Genuine new admission after initial denial" });
  await pending;
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, recovery)],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(remote).toHaveBeenCalledTimes(1);
});

it("retains absent named obligations and accepts their recovery in either descriptor order", async () => {
  const client = makeClient();
  const a = key("named-alpha");
  const b = key("named-beta");
  await deny(client, a);
  await deny(client, b);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, a, "alpha"), descriptor(client, b, "beta")],
    client,
  );
  expect(authority.denied).toBe(true);
  const alpha = vi.fn(async () => ({ label: "Alpha recovered" }));
  const beta = vi.fn(async () => ({ label: "Beta recovered" }));
  await fetchRead(client, a, alpha);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, a, "alpha")],
    client,
  );
  expect(authority.denied).toBe(true);
  await fetchRead(client, b, beta);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b, "beta")],
    client,
  );
  expect(authority.denied).toBe(true);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b, "beta"), descriptor(client, a, "alpha")],
    client,
  );
  expect(authority.denied).toBe(false);
  expect(
    reconcileSessionAccessDenied(
      authority,
      [descriptor(client, a, "alpha"), descriptor(client, b, "beta")],
      client,
    ),
  ).toBe(authority);
  expect(alpha).toHaveBeenCalledTimes(1);
  expect(beta).toHaveBeenCalledTimes(1);
});

it("keeps identity-replacement clients separate from late old-client completion", async () => {
  const first = makeClient();
  const second = makeClient();
  const queryKey = key("identity");
  await deny(first, queryKey);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(first, queryKey)],
    first,
  );
  expect(authority.denied).toBe(true);
  const held = deferred<ReadData>();
  const pending = fetchRead(first, queryKey, () => held.promise);
  void pending.catch(() => undefined);
  await fetchRead(second, queryKey, async () => ({
    label: "New identity's own read",
  }));
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(second, queryKey)],
    second,
  );
  expect(authority.denied).toBe(false);
  expect(authority.client).toBe(second);
  const secondProof = receipts(second).read(
    currentQuery(second, queryKey),
  ).proof;
  const secondRevision = receipts(second).getSnapshot();

  held.resolve({ label: "Late old identity result" });
  await pending;
  expect(receipts(second).getSnapshot()).toBe(secondRevision);
  expect(receipts(second).read(currentQuery(second, queryKey)).proof).toBe(
    secondProof,
  );
  expect(
    receipts(second).read(currentQuery(first, queryKey)).proof,
  ).toBeUndefined();
  expect(
    reconcileSessionAccessDenied(
      authority,
      [descriptor(second, queryKey)],
      second,
    ),
  ).toBe(authority);
});

it("rejects an older successful domain projection when the current read is domain-invalid", async () => {
  const client = makeClient();
  const queryKey = key("current-domain");
  await fetchRead(client, queryKey, async () => ({
    label: "Older valid observer data",
  }));
  const capturedSuccess = descriptor(client, queryKey);
  await deny(client, queryKey);
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, queryKey)],
    client,
  );
  await fetchRead(client, queryKey, async () => null);
  expect(
    receipts(client).read(currentQuery(client, queryKey)).proof,
  ).toBeDefined();
  authority = reconcileSessionAccessDenied(
    authority,
    [capturedSuccess],
    client,
  );
  expect(authority.denied).toBe(true);
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, queryKey)],
    client,
  );
  expect(authority.denied).toBe(true);
  await fetchRead(client, queryKey, async () => ({
    label: "Current valid recovery",
  }));
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, queryKey)],
    client,
  );
  expect(authority.denied).toBe(false);
});

it("reduces an old binding's denial before adopting another cached scope", async () => {
  const client = makeClient();
  const a = key("previous-binding");
  const b = key("replacement-binding");
  await fetchRead(client, a, async () => ({ label: "Initial previous scope" }));
  await fetchRead(client, b, async () => ({
    label: "Cached replacement scope",
  }));
  let authority = reconcileSessionAccessDenied(
    createSessionAccessAuthority(),
    [descriptor(client, a)],
    client,
  );
  expect(authority.denied).toBe(false);
  await deny(client, a);
  // No intermediate reconciliation: denial and an input reset can precede the
  // next React publication, but the retained previous Query still owns its D.
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b)],
    client,
  );
  expect(authority.denied).toBe(true);
  await fetchRead(client, b, async () => ({ label: "Fresh replacement read" }));
  authority = reconcileSessionAccessDenied(
    authority,
    [descriptor(client, b)],
    client,
  );
  expect(authority.denied).toBe(false);
});
