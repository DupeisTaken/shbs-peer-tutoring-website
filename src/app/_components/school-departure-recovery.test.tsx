// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  QueryClientProvider,
  type QueryClient,
  type InvalidateOptions,
  type InvalidateQueryFilters,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { SchoolDeparturePanel } from "./school-departure";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";

type Failure = Error & { data?: { code?: string; approvalId?: string } };
type DepartureInput = {
  action: "GRADUATED" | "TRANSFERRED" | "RETURN" | "REVOKE" | "RESTORE";
  explanation: string;
  expectedRevision: number;
  userId?: string;
};
type DepartureRead = {
  retired: boolean;
  departure: { reason: string; revision: number; observerRevoked: boolean };
  access: { canReadManagement: boolean };
  role: string;
  events: { id: string; action: string; explanation: string }[];
};
type MutationOptions = {
  onSuccess?: () => unknown;
  onError?: (error: Failure) => unknown;
  onSettled?: () => unknown;
};
const fixture = vi.hoisted(() => ({
  data: {
    retired: false,
    departure: { reason: "TRANSFERRED", revision: 2, observerRevoked: false },
    access: { canReadManagement: true },
    role: "HEAD",
    events: [
      {
        id: "synthetic-history",
        action: "TRANSFERRED",
        explanation: "Synthetic private departure history",
      },
    ],
  },
  seeded: true,
  reads: vi.fn<() => Promise<DepartureRead>>(),
  save: vi.fn<(input: DepartureInput) => Promise<void>>(),
  request: vi.fn<(input: DepartureInput) => Promise<void>>(),
  refresh: vi.fn(),
  close: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: fixture.refresh }),
}));
vi.mock("./management-actions", () => ({
  ManagementActions: () => <div>My requests</div>,
}));
// Replace only transport. TanStack owns cached data, status timestamps, callback
// awaits, mutation errors/reset and the complete refetch lifecycle.
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  const mutation = (operation: "save" | "request") => ({
    useMutation: (options: MutationOptions) =>
      useMutation({
        mutationFn: (input: DepartureInput): Promise<void> =>
          fixture[operation](input),
        retry: false,
        ...options,
      }),
  });
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        return {
          invalidate: (
            _input?: undefined,
            filters?: InvalidateQueryFilters,
            options?: InvalidateOptions,
          ) => client.invalidateQueries(filters, options),
        };
      },
      departure: {
        state: {
          _def: () => ({ path: ["departure", "state"] }),
          useQuery: ({ userId }: { userId?: string }) =>
            useQuery<DepartureRead, Failure>({
              queryKey: getQueryKey(api.departure.state, { userId }, "query"),
              queryFn: (): Promise<DepartureRead> => fixture.reads(),
              initialData: fixture.seeded ? snapshot() : undefined,
              staleTime: Infinity,
              retry: false,
            }),
        },
        setState: mutation("save"),
        request: mutation("request"),
      },
    },
  };
});

// These fallbacks let transport regressions land independently of the catalogs.
const copy = Object.assign(
  {
    loading: "Loading school departure record…",
    loadFailed: "Could not load the school departure record.",
    readFailed:
      "Could not refresh the school departure record. Your draft is retained.",
    reload: "Reload current record",
    reloadHelp:
      "The record changed. Reload and review your reason before submitting.",
    retryRefresh: "Retry refresh",
    refreshing: "Change accepted. Refreshing the current record…",
    refreshFailed:
      "Change accepted, but the current record could not be refreshed.",
    accessDenied: "You no longer have access to this school departure record.",
  },
  messages.schoolDeparture,
);
const localized = { ...messages, schoolDeparture: copy };
const clients: QueryClient[] = [];
const snapshot = () => ({
  ...fixture.data,
  departure: { ...fixture.data.departure },
  access: { ...fixture.data.access },
  events: fixture.data.events.map((event) => ({ ...event })),
});
const failure = (message: string, data?: Failure["data"]): Failure =>
  Object.assign(new Error(message), { data });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const reason = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: copy.reason });
const action = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: copy.change });
const retry = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: copy.retryRefresh });
const confirm = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: copy.confirm });
const openReview = (request = false) =>
  fireEvent.click(
    screen.getByRole("button", { name: request ? copy.request : copy.review }),
  );
const submit = (request = false) => {
  openReview(request);
  fireEvent.click(confirm());
};
const queryKey = (self = false) =>
  getQueryKey(
    api.departure.state,
    { userId: self ? undefined : "synthetic-departure-target" },
    "query",
  );

function SiblingDraft({ pending }: { pending: boolean }) {
  const busy = useDialogPending(pending);
  return (
    <input
      aria-label="Sibling draft"
      defaultValue="Unsaved sibling reason"
      disabled={busy}
    />
  );
}

function renderPanel({
  self = false,
  parent = false,
  siblingPending = false,
} = {}) {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false },
    mutations: { ...defaults.mutations, retry: false },
  });
  clients.push(client);
  const content = (pending: boolean) => {
    const panel = (
      <SchoolDeparturePanel
        userId={self ? undefined : "synthetic-departure-target"}
      />
    );
    return (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={localized}>
          {parent ? (
            <ProfileDialog title="Parent account" onClose={fixture.close}>
              <SiblingDraft pending={pending} />
              {panel}
            </ProfileDialog>
          ) : (
            panel
          )}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  };
  const view = render(content(siblingPending));
  return {
    ...view,
    client,
    rerenderSibling: (pending: boolean) => view.rerender(content(pending)),
  };
}

beforeEach(() => {
  fixture.data.departure.revision = 2;
  fixture.data.role = "HEAD";
  fixture.seeded = true;
  fixture.reads.mockReset().mockImplementation(async () => snapshot());
  fixture.save.mockReset().mockResolvedValue(undefined);
  fixture.request.mockReset().mockResolvedValue(undefined);
  fixture.refresh.mockReset();
  fixture.close.mockReset();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

it("audit: an initial failed read offers Retry and only enables review after a fresh successful read", async () => {
  fixture.seeded = false;
  fixture.reads.mockRejectedValueOnce(
    new Error("Synthetic initial read unavailable"),
  );
  renderPanel();
  expect(screen.queryByRole("textbox")).toBeNull();
  await screen.findByText(copy.loadFailed);
  expect(screen.queryByRole("button", { name: copy.review })).toBeNull();
  fireEvent.click(retry());
  await screen.findByRole("textbox", { name: copy.reason });
  expect(reason().disabled).toBe(false);
  expect(fixture.save).not.toHaveBeenCalled();
  expect(fixture.request).not.toHaveBeenCalled();
});

it.each([2, 3])(
  "audit: cached failure retains the draft and history; Retry reading revision %s does not silently rebase it",
  async (revision) => {
    const { client } = renderPanel();
    fireEvent.change(reason(), {
      target: { value: "Retained synthetic return reason" },
    });
    fireEvent.change(action(), { target: { value: "RETURN" } });
    openReview();
    fixture.reads.mockRejectedValueOnce(
      new Error("Synthetic cached read unavailable"),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKey() });
    });
    await screen.findByText(copy.readFailed);
    expect(reason().value).toBe("Retained synthetic return reason");
    expect(action().value).toBe("RETURN");
    expect(
      screen.getByText("Synthetic private departure history"),
    ).toBeTruthy();
    expect(reason().disabled).toBe(true);
    expect(action().disabled).toBe(true);
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    fixture.data.departure.revision = revision;
    fireEvent.click(retry());
    if (revision === 2)
      await waitFor(() => expect(reason().disabled).toBe(false));
    else {
      await screen.findByRole("button", { name: copy.reload });
      expect(confirm().disabled).toBe(true);
      fireEvent.click(confirm());
    }
    expect(reason().value).toBe("Retained synthetic return reason");
    expect(action().value).toBe("RETURN");
    expect(screen.getByRole("dialog", { name: copy.review })).toBeTruthy();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
  },
);

it("audit: a background revision cannot rebase an unsaved reason; Reload fetches before adopting a new revision", async () => {
  const { client } = renderPanel();
  fireEvent.change(reason(), { target: { value: "Retained factual return" } });
  fireEvent.change(action(), { target: { value: "RETURN" } });
  openReview();
  fixture.data.departure.revision = 3;
  await act(async () => {
    await client.refetchQueries({ queryKey: queryKey() });
  });
  const reload = await screen.findByRole("button", { name: copy.reload });
  expect(confirm().disabled).toBe(true);
  fireEvent.click(confirm());
  expect(fixture.save).not.toHaveBeenCalled();
  const read = deferred<ReturnType<typeof snapshot>>();
  fixture.reads.mockImplementationOnce(() => read.promise);
  fireEvent.click(reload);
  expect(reason().value).toBe("Retained factual return");
  expect(action().value).toBe("RETURN");
  expect(confirm().disabled).toBe(true);
  fixture.data.departure.revision = 4;
  await act(async () => {
    read.resolve(snapshot());
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(reason().value).toBe("Retained factual return");
  expect(action().value).toBe("RETURN");
  submit();
  await waitFor(() =>
    expect(fixture.save).toHaveBeenCalledWith({
      userId: "synthetic-departure-target",
      action: "RETURN",
      expectedRevision: 4,
      explanation: "Retained factual return",
    }),
  );
  await waitFor(() => expect(reason().value).toBe(""));
});

it("audit: failed conflict Reload keeps the original reason and review until a later successful Reload", async () => {
  fixture.save.mockRejectedValueOnce(
    failure("Synthetic departure changed", { code: "CONFLICT" }),
  );
  const { client } = renderPanel();
  fireEvent.change(reason(), {
    target: { value: "Conflicting synthetic return" },
  });
  fireEvent.change(action(), { target: { value: "RETURN" } });
  submit();
  await screen.findByRole("button", { name: copy.reload });
  expect(fixture.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2 }),
  );
  fixture.data.departure.revision = 3;
  await act(async () => {
    await client.refetchQueries({ queryKey: queryKey() });
  });
  fixture.reads.mockRejectedValueOnce(
    new Error("Synthetic Reload unavailable"),
  );
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await screen.findByText(copy.readFailed);
  expect(reason().value).toBe("Conflicting synthetic return");
  expect(action().value).toBe("RETURN");
  expect(screen.getByRole("dialog", { name: copy.review })).toBeTruthy();
  expect(confirm().disabled).toBe(true);
  fireEvent.click(confirm());
  expect(fixture.save).toHaveBeenCalledTimes(1);
  fixture.data.departure.revision = 4;
  fireEvent.click(screen.getByRole("button", { name: copy.reload }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(reason().value).toBe("Conflicting synthetic return");
  expect(action().value).toBe("RETURN");
  submit();
  await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(2));
  expect(fixture.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 4,
      explanation: "Conflicting synthetic return",
      action: "RETURN",
    }),
  );
  await waitFor(() => expect(reason().value).toBe(""));
});

it.each([
  { mode: "self request", self: true, role: "STUDENT", queued: false },
  { mode: "direct staff save", self: false, role: "HEAD", queued: false },
  {
    mode: "queued staff proposal",
    self: false,
    role: "COORDINATOR",
    queued: true,
  },
])(
  "audit: accepted $mode with failed refresh stays read-only and Retry never repeats the mutation",
  async ({ self, role, queued }) => {
    fixture.data.role = role;
    if (queued)
      fixture.save.mockRejectedValueOnce(
        failure("Synthetic proposal queued", {
          code: "FORBIDDEN",
          approvalId: "synthetic-approval",
        }),
      );
    const { client } = renderPanel({ self, parent: true });
    fireEvent.change(reason(), {
      target: { value: "Accepted synthetic departure" },
    });
    fixture.reads.mockRejectedValue(
      new Error("Synthetic accepted refresh unavailable"),
    );
    submit(self || queued);
    await screen.findByText(copy.refreshFailed);
    await waitFor(() => expect(retry().disabled).toBe(false));
    const write = self ? fixture.request : fixture.save;
    expect(write).toHaveBeenCalledTimes(1);
    expect(reason().value).toBe("Accepted synthetic departure");
    expect(reason().disabled).toBe(true);
    expect(action().disabled).toBe(true);
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    for (const dialog of screen.getAllByRole("dialog")) {
      expect(
        within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
          .disabled,
      ).toBe(false);
    }
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Sibling draft" })
        .disabled,
    ).toBe(false);
    expect(retry().disabled).toBe(false);
    // Even a second failed refresh must remain a read after mutation pending ends.
    const reads = fixture.reads.mock.calls.length;
    fireEvent.click(retry());
    await waitFor(() =>
      expect(fixture.reads.mock.calls.length).toBeGreaterThan(reads),
    );
    await waitFor(() => expect(retry().disabled).toBe(false));
    expect(write).toHaveBeenCalledTimes(1);
    fixture.data.departure.revision = 5;
    fixture.reads.mockImplementation(async () => snapshot());
    fireEvent.click(retry());
    await waitFor(() => expect(reason().value).toBe(""));
    expect(
      client.getQueryData<ReturnType<typeof snapshot>>(queryKey(self))
        ?.departure.revision,
    ).toBe(5);
    expect(
      screen.getByText(self || queued ? copy.requested : copy.saved),
    ).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.change(reason(), { target: { value: "Next deliberate review" } });
    submit(self || queued);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 5,
        explanation: "Next deliberate review",
      }),
    );
    await waitFor(() => expect(reason().value).toBe(""));
  },
);

it("audit: accepted completion waits for a registered sibling and releases parent and sibling controls after it settles", async () => {
  const read = deferred<ReturnType<typeof snapshot>>();
  fixture.reads.mockImplementation(() => read.promise);
  const view = renderPanel({ parent: true });
  fireEvent.change(reason(), {
    target: { value: "Synthetic pending completion" },
  });
  submit();
  await waitFor(() => expect(fixture.reads).toHaveBeenCalled());
  expect(reason().disabled).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Sibling draft" })
      .disabled,
  ).toBe(true);
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  }
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  view.rerenderSibling(true);
  fixture.data.departure.revision = 3;
  await act(async () => {
    read.resolve(snapshot());
  });
  await waitFor(() => expect(view.client.isMutating()).toBe(0));
  expect(reason().value).toBe("Synthetic pending completion");
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  view.rerenderSibling(false);
  await waitFor(() => expect(reason().value).toBe(""));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Sibling draft" })
      .value,
  ).toBe("Unsaved sibling reason");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Sibling draft" })
      .disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
  ).toBe(false);
  expect(fixture.close).not.toHaveBeenCalled();
});

it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "audit: %s conceals cached private history and review through later transport failure until an authorized read succeeds",
  async (code) => {
    const { client } = renderPanel();
    fireEvent.change(reason(), {
      target: { value: "Synthetic confidential draft" },
    });
    openReview();
    fixture.reads.mockRejectedValueOnce(
      failure("Synthetic authorization revoked", { code }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKey() });
    });
    await screen.findByText(copy.accessDenied);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Synthetic confidential draft")).toBeNull();
    expect(
      screen.queryByText("Synthetic private departure history"),
    ).toBeNull();
    fixture.reads.mockRejectedValueOnce(
      new Error("Synthetic transport failure after denial"),
    );
    fireEvent.click(retry());
    await waitFor(() => expect(retry().disabled).toBe(false));
    expect(screen.getByText(copy.accessDenied)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByText("Synthetic private departure history"),
    ).toBeNull();
    fireEvent.click(retry());
    await screen.findByRole("textbox", { name: copy.reason });
    expect(screen.queryByText(copy.accessDenied)).toBeNull();
    expect(reason().value).toBe("Synthetic confidential draft");
    expect(
      screen.getByText("Synthetic private departure history"),
    ).toBeTruthy();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
  },
);

it("audit: a rejected unauthorized write conceals cached evidence until fresh read recovery clears the write error", async () => {
  fixture.save.mockRejectedValueOnce(
    failure("Synthetic write authorization revoked", { code: "FORBIDDEN" }),
  );
  renderPanel();
  fireEvent.change(reason(), {
    target: { value: "Synthetic private rejected reason" },
  });
  submit();
  await screen.findByText(copy.accessDenied);
  await waitFor(() => expect(retry().disabled).toBe(false));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("Synthetic private departure history")).toBeNull();
  fixture.reads.mockRejectedValueOnce(
    new Error("Synthetic recovery transport unavailable"),
  );
  fireEvent.click(retry());
  await waitFor(() => expect(retry().disabled).toBe(false));
  expect(screen.getByText(copy.accessDenied)).toBeTruthy();
  fireEvent.click(retry());
  await screen.findByRole("textbox", { name: copy.reason });
  expect(reason().value).toBe("Synthetic private rejected reason");
  expect(screen.queryByText(copy.accessDenied)).toBeNull();
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(fixture.request).not.toHaveBeenCalled();
});
