/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
  dehydrate,
  hydrate,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { useSessionAccessDenied } from "./session-view-state";

type PrivateRead = { label: string };
type ReadData = PrivateRead | { label: number } | null;
type ReadError = Error & { data?: { code?: string } };
type ProbeOptions = {
  initialData?: PrivateRead;
  requirePrerequisite?: boolean;
};

const privateKey = ["session-denial-current-data", "private"] as const;
const prerequisiteKey = [
  "session-denial-current-data",
  "prerequisite",
] as const;
const remote = vi.fn<() => Promise<ReadData>>();
const prerequisiteRemote = vi.fn<() => Promise<ReadData>>();
const invalidResponses: { name: string; value: ReadData }[] = [
  { name: "null", value: null },
  { name: "malformed", value: { label: 17 } },
];
const epoch = Date.UTC(2026, 10, 9, 12);
let clock: number;
let client: QueryClient;
let donors: QueryClient[];
let readOrder: string[];
let privateCommits: string[];
let recordPrivateCommits: boolean;

function validPrivateRead(value: ReadData | undefined): value is PrivateRead {
  return value != null && typeof value.label === "string";
}

function makeClient() {
  const created = createQueryClient();
  const defaults = created.getDefaultOptions();
  created.setDefaultOptions({
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
  return created;
}

function PrivateEvidence({ label }: { label: string }) {
  useLayoutEffect(() => {
    if (recordPrivateCommits) privateCommits.push(label);
  }, [label]);
  return <p data-testid="private-evidence">{label}</p>;
}

function PrivateReadProbe({
  initialData,
  requirePrerequisite = false,
}: ProbeOptions) {
  const read = useQuery<ReadData, ReadError>({
    queryKey: privateKey,
    queryFn: () => {
      readOrder.push("private");
      return remote();
    },
    ...(initialData ? { initialData, refetchOnMount: "always" as const } : {}),
  });
  const prerequisite = useQuery<ReadData, ReadError>({
    queryKey: prerequisiteKey,
    queryFn: () => {
      readOrder.push("prerequisite");
      return prerequisiteRemote();
    },
    enabled: requirePrerequisite,
  });
  // The caller accepts a successful read only when its current data has the
  // required shape. A later cache write must not borrow an earlier read's proof.
  const privateDescriptor = {
    ...read,
    queryKey: privateKey,
    denialKey: "private-read",
    isSuccess: read.isSuccess && validPrivateRead(read.data),
  };
  const prerequisiteDescriptor = {
    ...prerequisite,
    queryKey: prerequisiteKey,
    denialKey: "private-prerequisite",
    isSuccess: prerequisite.isSuccess && validPrivateRead(prerequisite.data),
  };
  const denied = useSessionAccessDenied(
    privateDescriptor,
    ...(requirePrerequisite ? [prerequisiteDescriptor] : []),
  );
  return (
    <>
      <output aria-label="Private query observer">
        {`${read.status}:${read.fetchStatus}:${privateDescriptor.isSuccess ? "valid" : "invalid"}:${read.dataUpdatedAt}`}
      </output>
      {requirePrerequisite && (
        <output aria-label="Prerequisite query observer">
          {`${prerequisite.status}:${prerequisite.fetchStatus}:${prerequisiteDescriptor.isSuccess ? "valid" : "invalid"}:${prerequisite.dataUpdatedAt}`}
        </output>
      )}
      {denied ? (
        <p role="alert">Access denied</p>
      ) : (
        privateDescriptor.isSuccess &&
        (!requirePrerequisite || prerequisiteDescriptor.isSuccess) &&
        validPrivateRead(read.data) && (
          <PrivateEvidence label={read.data.label} />
        )
      )}
    </>
  );
}

function privateQuery() {
  const query = client.getQueryCache().find<ReadData, ReadError>({
    queryKey: privateKey,
    exact: true,
  });
  if (!query) throw new Error("Expected the mounted private query");
  return query;
}

async function waitForPrivateCommit() {
  await waitFor(() => {
    const { status, fetchStatus, dataUpdatedAt, data } = privateQuery().state;
    const domain = status === "success" && validPrivateRead(data);
    expect(screen.getByLabelText("Private query observer").textContent).toBe(
      `${status}:${fetchStatus}:${domain ? "valid" : "invalid"}:${dataUpdatedAt}`,
    );
  });
}

function expectConcealed() {
  expect(screen.getByRole("alert").textContent).toBe("Access denied");
  expect(screen.queryByTestId("private-evidence")).toBeNull();
  expect(privateCommits).toEqual([]);
}

async function startDenied(options: ProbeOptions = {}) {
  remote.mockResolvedValueOnce({ label: "Private initial evidence" });
  if (options.requirePrerequisite)
    prerequisiteRemote.mockResolvedValueOnce(null);
  render(
    <QueryClientProvider client={client}>
      <PrivateReadProbe {...options} />
    </QueryClientProvider>,
  );
  await waitForPrivateCommit();
  await waitFor(() => expect(privateQuery().state.status).toBe("success"));
  if (options.requirePrerequisite) {
    await waitFor(() => {
      expect(
        screen.getByLabelText("Prerequisite query observer").textContent,
      ).toBe(`success:idle:invalid:${epoch}`);
    });
  } else {
    await screen.findByText("Private initial evidence");
  }
  expect(remote).toHaveBeenCalledTimes(1);
  clock += 100;
  remote.mockRejectedValueOnce(
    Object.assign(new Error("Access revoked"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: privateKey, exact: true });
  });
  await screen.findByRole("alert");
  await waitForPrivateCommit();
  expect(privateQuery().state.status).toBe("error");
  expect(remote).toHaveBeenCalledTimes(2);
  expectConcealed();
  // Subsequent assertions reject a transient private commit as well as the
  // final DOM. The legitimate initial read is outside this concealment episode.
  recordPrivateCommits = true;
}

async function freshPrivateRead(data: ReadData) {
  const before = privateQuery().promise;
  const calls = remote.mock.calls.length;
  clock += 100;
  remote.mockResolvedValueOnce(data);
  await act(async () => {
    await client.refetchQueries({ queryKey: privateKey, exact: true });
  });
  await waitForPrivateCommit();
  expect(privateQuery().state.status).toBe("success");
  expect(privateQuery().state.fetchStatus).toBe("idle");
  expect(privateQuery().state.dataUpdatedAt).toBe(clock);
  expect(privateQuery().promise).toBeDefined();
  expect(privateQuery().promise).not.toBe(before);
  expect(remote).toHaveBeenCalledTimes(calls + 1);
  // Keep the identity inside an object: an async helper returning the promise
  // directly would assimilate it and hand its data back to the test instead.
  return { promise: privateQuery().promise };
}

async function recoverWithRealRead() {
  await freshPrivateRead({ label: "Fresh authorized evidence" });
  await screen.findByText("Fresh authorized evidence");
  expect(screen.queryByRole("alert")).toBeNull();
}

beforeEach(() => {
  clock = epoch;
  // Notification timers remain real. Forward timestamps deliberately expose
  // cache writes that the old wall-clock comparison incorrectly trusts.
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  remote.mockReset();
  prerequisiteRemote.mockReset();
  readOrder = [];
  privateCommits = [];
  recordPrivateCommits = false;
  donors = [];
  client = makeClient();
});

afterEach(() => {
  cleanup();
  client.clear();
  for (const donor of donors) donor.clear();
  vi.restoreAllMocks();
});

it.each(invalidResponses)(
  "does not lend a successful $name read's authority to later valid manual data",
  async ({ value }) => {
    await startDenied();
    const { promise: invalidPromise } = await freshPrivateRead(value);
    expectConcealed();

    clock += 100;
    await act(async () => {
      client.setQueryData<ReadData>(privateKey, (): ReadData => ({
        label: "Manually inserted private evidence",
      }));
    });
    await waitForPrivateCommit();
    expect(privateQuery().state.data).toEqual({
      label: "Manually inserted private evidence",
    });
    expect(privateQuery().promise).toBe(invalidPromise);
    expect(remote).toHaveBeenCalledTimes(3);
    expectConcealed();

    await recoverWithRealRead();
    expect(readOrder).toEqual(["private", "private", "private", "private"]);
  },
);

it.each(invalidResponses)(
  "does not lend a successful $name read's authority to later hydrated valid data",
  async ({ value }) => {
    await startDenied();
    const { promise: invalidPromise } = await freshPrivateRead(value);
    expectConcealed();

    clock += 100;
    const donor = makeClient();
    donors.push(donor);
    donor.setQueryData<ReadData>(privateKey, (): ReadData => ({
      label: "Hydrated private evidence",
    }));
    const snapshot = dehydrate(donor);
    expect(snapshot.queries).toHaveLength(1);
    await act(async () => {
      hydrate(client, snapshot);
    });
    await waitForPrivateCommit();
    expect(privateQuery().state.data).toEqual({
      label: "Hydrated private evidence",
    });
    expect(privateQuery().state.dataUpdatedAt).toBe(clock);
    expect(privateQuery().promise).toBe(invalidPromise);
    expect(remote).toHaveBeenCalledTimes(3);
    expectConcealed();

    await recoverWithRealRead();
    expect(readOrder).toEqual(["private", "private", "private", "private"]);
  },
);

it.each(invalidResponses)(
  "invalidates pending authority when a $name fetch success is synchronously replaced by manual valid data",
  async ({ value }) => {
    await startDenied();
    const target = privateQuery();
    const actions: string[] = [];
    let armed = true;
    let injecting = false;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.query !== target ||
        event.action.type !== "success"
      )
        return;
      if (event.action.manual) {
        if (injecting) actions.push("manual-valid-success");
        return;
      }
      // Classify the immutable success action, since nested setQueryData will
      // replace query.state before this outer notification has finished.
      if (!armed || validPrivateRead(event.action.data as ReadData | undefined))
        return;
      armed = false;
      actions.push("invalid-fetch-success");
      injecting = true;
      try {
        client.setQueryData<ReadData>(privateKey, (): ReadData => ({
          label: "Manual private evidence during fetch notification",
        }));
      } finally {
        injecting = false;
      }
    });
    try {
      const { promise: invalidPromise } = await freshPrivateRead(value);
      expect(actions).toEqual([
        "invalid-fetch-success",
        "manual-valid-success",
      ]);
      expect(armed).toBe(false);
      expect(privateQuery().state.data).toEqual({
        label: "Manual private evidence during fetch notification",
      });
      expect(privateQuery().promise).toBe(invalidPromise);
      expect(remote).toHaveBeenCalledTimes(3);
      expectConcealed();

      await recoverWithRealRead();
      expect(readOrder).toEqual(["private", "private", "private", "private"]);
    } finally {
      unsubscribe();
    }
  },
);

it("does not lend a rejected-domain read's authority to valid initial data restored by reset", async () => {
  const initialData = { label: "Initial private snapshot" };
  await startDenied({ initialData });
  const { promise: invalidPromise } = await freshPrivateRead(null);
  expectConcealed();

  clock += 100;
  await act(async () => {
    // Query.reset performs the actual reset-state action without resetQueries'
    // automatic active refetch obscuring which data generation is displayed.
    privateQuery().reset();
  });
  await waitForPrivateCommit();
  expect(privateQuery().state.data).toEqual(initialData);
  expect(privateQuery().state.dataUpdatedAt).toBe(epoch);
  expect(privateQuery().promise).toBe(invalidPromise);
  expect(remote).toHaveBeenCalledTimes(3);
  expectConcealed();

  await recoverWithRealRead();
  expect(readOrder).toEqual(["private", "private", "private", "private"]);
});

it.each(["same reference", "equal value"] as const)(
  "invalidates an unused valid-read proof after a manual write with the %s",
  async (mode) => {
    await startDenied({ requirePrerequisite: true });
    const { promise: fetchedPromise } = await freshPrivateRead({
      label: "Valid but not yet usable evidence",
    });
    // The actual prerequisite query still has successful-null data, so the
    // private read's valid proof has not legitimately released the denial.
    expectConcealed();
    const fetched = privateQuery().state.data;
    if (!validPrivateRead(fetched))
      throw new Error("Expected valid fetched data");

    clock += 100;
    await act(async () => {
      client.setQueryData<ReadData>(
        privateKey,
        mode === "same reference" ? fetched : { ...fetched },
      );
    });
    await waitForPrivateCommit();
    // Default structural sharing preserves the reference in both cases; data
    // identity therefore cannot substitute for the authority-data generation.
    expect(privateQuery().state.data).toBe(fetched);
    expect(privateQuery().promise).toBe(fetchedPromise);
    expect(remote).toHaveBeenCalledTimes(3);
    expectConcealed();

    clock += 100;
    prerequisiteRemote.mockResolvedValueOnce({ label: "Fresh prerequisite" });
    await act(async () => {
      await client.refetchQueries({ queryKey: prerequisiteKey, exact: true });
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText("Prerequisite query observer").textContent,
      ).toBe(`success:idle:valid:${clock}`);
    });
    expect(prerequisiteRemote).toHaveBeenCalledTimes(2);
    expect(remote).toHaveBeenCalledTimes(3);
    expectConcealed();

    await recoverWithRealRead();
    expect(readOrder).toEqual([
      "private",
      "prerequisite",
      "private",
      "private",
      "prerequisite",
      "private",
    ]);
  },
);

it("does not create a new denial when manual data changes after legitimate read recovery", async () => {
  await startDenied();
  await recoverWithRealRead();
  const recoveredPromise = privateQuery().promise;

  clock += 100;
  await act(async () => {
    client.setQueryData<ReadData>(privateKey, (): ReadData => ({
      label: "Permitted local snapshot after recovery",
    }));
  });
  await waitForPrivateCommit();
  expect(privateQuery().promise).toBe(recoveredPromise);
  expect(remote).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByTestId("private-evidence").textContent).toBe(
    "Permitted local snapshot after recovery",
  );
  expect(readOrder).toEqual(["private", "private", "private"]);
});
