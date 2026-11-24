/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { SessionFlagBoard } from "./session-flag-board";
import { SessionViewProvider } from "./session-view-state";
import { createQueryClient } from "~/trpc/query-client";

const flag = {
  id: "flag",
  tutor: "Alex",
  subject: "Math",
  expected: 2,
  observed: 1,
  date: new Date("2026-10-01"),
  room: "Room A",
  startMin: 720,
  endMin: 780,
  state: "PENDING",
  decisionNote: null,
  resolvedAt: null,
  resolvedByName: null,
};
const mock = vi.hoisted(() => ({
  real: false,
  input: ((): unknown => undefined)(),
  data: [] as unknown[],
  readOnly: false,
  pending: false,
  error: null as null | {
    message: string;
    data?: { code?: string; approvalId?: string };
  },
  mutationError: null as null | {
    message: string;
    data?: { approvalId?: string };
  },
  mutate: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  queryFn: undefined as
    undefined | ((input: { state: string }) => Promise<unknown[]>),
  success: undefined as
    | undefined
    | ((_result: unknown, input: { flagId: string }) => Promise<void>),
  failed: undefined as
    | undefined
    | ((
        error: { data?: { approvalId?: string } },
        input: { flagId: string },
      ) => void),
}));
vi.mock("./read-only", () => ({ useReadOnly: () => mock.readOnly }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_procedure: unknown, input?: unknown) =>
    input === undefined ? ["flags"] : ["flags", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { sessionFlags: { invalidate: mock.invalidate } },
    }),
    admin: {
      sessionFlags: {
        useQuery: (
          input: { state: string },
          options?: { enabled?: boolean },
        ) => {
          mock.input = input;
          const live = useQuery({
            queryKey: ["flags", input],
            queryFn: async () => {
              if (mock.queryFn) return mock.queryFn(input);
              if (mock.error)
                throw Object.assign(new Error(mock.error.message), mock.error);
              return mock.data;
            },
            enabled: mock.real && options?.enabled !== false,
          });
          if (mock.real) return live;
          return {
            data: mock.data,
            error: mock.error,
            isSuccess: !mock.error,
            isFetching: false,
            refetch: mock.refetch,
          };
        },
      },
      decideSessionFlag: {
        useMutation: (options: {
          onSuccess: typeof mock.success;
          onError: typeof mock.failed;
        }) => {
          mock.success = options.onSuccess;
          mock.failed = options.onError;
          return {
            mutate: mock.mutate,
            isPending: mock.pending,
            error: mock.mutationError,
            reset: () => {
              mock.mutationError = null;
            },
          };
        },
      },
    },
  },
}));
let client: QueryClient;
const show = () =>
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  client = createQueryClient();
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
  mock.real = false;
  mock.data = [flag];
  mock.error = null;
  mock.mutationError = null;
  mock.readOnly = false;
  mock.pending = false;
  mock.queryFn = undefined;
  mock.invalidate.mockResolvedValue(undefined);
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
  client.clear();
});
it("defaults to Pending and reads resolved state filters without exposing decision controls", () => {
  const view = show();
  expect(mock.input).toEqual({ state: "PENDING" });
  fireEvent.click(screen.getByRole("button", { name: "Penalized" }));
  expect(mock.input).toEqual({ state: "PENALIZED" });
  mock.data = [
    { ...flag, state: "PENALIZED", decisionNote: "Recorded decision" },
  ];
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: en.admin.sessionFlags.penalize }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "View details: Alex · Math" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Recorded decision"),
  ).toBeTruthy();
});
it("opens the penalty editor on demand and preserves drafts through close/reopen and same-turn submission", () => {
  show();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  const trigger = screen.getByRole("button", {
    name: en.admin.sessionFlags.penalize,
  });
  trigger.focus();
  fireEvent.click(trigger);
  let dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Review reason" },
  });
  fireEvent.change(within(dialog).getByRole("spinbutton"), {
    target: { value: "1.25" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Review reason",
  );
  const submit = within(dialog).getByRole("button", {
    name: en.admin.sessionFlags.penalize,
  });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(mock.mutate).toHaveBeenCalledExactlyOnceWith({
    flagId: "flag",
    action: "PENALIZE",
    note: "Review reason",
    penaltyHours: 1.25,
  });
});
it("keeps an accepted decision locked after failed refresh and retries reads without replay", async () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.penalize }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.admin.sessionFlags.penalize,
    }),
  );
  mock.invalidate.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await mock.success?.({}, { flagId: "flag" });
  });
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", {
      name: en.admin.sessionFlags.penalize,
    }),
  ).toBeNull();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.uiPatterns.retry,
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mock.mutate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps notes after rejection and protects pending dismissal", () => {
  const view = show();
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.penalize }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Retained" },
  });
  mock.pending = true;
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    within(dialog)
      .getByRole<HTMLTextAreaElement>("textbox")
      .matches(":disabled"),
  ).toBe(true);
  mock.pending = false;
  mock.mutationError = { message: "Decision rejected" };
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLTextAreaElement>("textbox")
      .value,
  ).toBe("Retained");
  expect(screen.getByRole("alert").textContent).toBe("Decision rejected");
});
it.each([true, false])(
  "retains cached rows beside transport recovery and conceals denied evidence (read-only: %s)",
  async (readOnly) => {
    mock.real = true;
    mock.readOnly = readOnly;
    let now = Date.UTC(2026, 10, 9, 12, 10);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    show();
    await waitFor(() => expect(screen.getByText("Alex · Math")).toBeTruthy());
    if (readOnly) {
      expect(
        screen.queryByRole("button", { name: en.admin.sessionFlags.warn }),
      ).toBeNull();
    }
    mock.error = { message: "Offline" };
    await act(async () => {
      await client.refetchQueries({ queryKey: ["flags"] });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Alex · Math")).toBeTruthy();
    expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
    expect(screen.queryByText(en.common.loading)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Dismissed" })
        .disabled,
    ).toBe(false);
    if (!readOnly) {
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: en.admin.sessionFlags.warn,
        }).disabled,
      ).toBe(true);
    }

    now = Date.UTC(2026, 10, 9, 12, 0);
    mock.error = { message: "Denied", data: { code: "FORBIDDEN" } };
    await act(async () => {
      await client.refetchQueries({ queryKey: ["flags"] });
    });
    await waitFor(() => expect(screen.queryByText("Alex · Math")).toBeNull());

    mock.error = { message: "Offline again" };
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() => expect(screen.queryByText("Alex · Math")).toBeNull());

    // Backward clock skew must not block fresh authorized recovery.
    now = Date.UTC(2026, 10, 9, 11, 50);
    mock.error = null;
    mock.data = [{ ...flag, tutor: "Fresh authorized tutor" }];
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
    await waitFor(() =>
      expect(screen.getByText("Fresh authorized tutor · Math")).toBeTruthy(),
    );
    vi.restoreAllMocks();
  },
);

it("shows one idle denial status with unavailable filters through failed Retry and fresh Pending recovery", async () => {
  window.sessionStorage.clear();
  mock.real = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const remove = vi.spyOn(client, "removeQueries");
  let historyDenied = false;
  let pendingOutcome: "cached" | "offline" | "fresh" = "cached";
  const pendingCalls = vi.fn();
  mock.queryFn = async ({ state }) => {
    if (state === "PENDING") {
      pendingCalls();
      if (pendingOutcome === "offline") throw new Error("Offline");
      if (pendingOutcome === "fresh")
        return [{ ...flag, tutor: "Fresh authorized tutor" }];
      return [{ ...flag, tutor: "Cached pending tutor" }];
    }
    if (historyDenied)
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    return [{ ...flag, tutor: "Resolved tutor", state: "DISMISSED" }];
  };
  const tree = () => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionViewProvider
          identity="head"
          pathname="/admin/session-flags"
          verified
        >
          <SessionFlagBoard />
        </SessionViewProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  render(tree());
  await waitFor(() =>
    expect(screen.getByText("Cached pending tutor · Math")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "All states" }));
  await waitFor(() =>
    expect(screen.getByText("Resolved tutor · Math")).toBeTruthy(),
  );

  // Move wall clock backward before denying the filtered scope.
  now = Date.UTC(2026, 10, 9, 12, 0);
  historyDenied = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ["flags", { state: "ALL" }] });
  });
  await waitFor(() => {
    expect(mock.input).toEqual({ state: "PENDING" });
    expect(screen.queryByText("Resolved tutor · Math")).toBeNull();
    expect(screen.queryByText("Cached pending tutor · Math")).toBeNull();
  });
  expect(remove).toHaveBeenCalledWith({ queryKey: ["flags"], exact: false });

  const expectDeniedBoard = () => {
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(en.common.loading)).toBeNull();
    expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
    expect(screen.queryByText("Resolved tutor · Math")).toBeNull();
    expect(screen.queryByText("Cached pending tutor · Math")).toBeNull();
    expect(screen.queryByText("Fresh authorized tutor · Math")).toBeNull();
    const choices = within(
      screen.getByRole("region", { name: en.admin.sessionFlags.filterLabel }),
    ).getAllByRole<HTMLButtonElement>("button");
    expect(choices.length).toBeGreaterThanOrEqual(4);
    for (const choice of choices) expect(choice.disabled).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Pending" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  };
  expectDeniedBoard();
  expect(screen.getByRole("status").textContent).toContain(
    en.uiPatterns.loadFailed,
  );
  const retry = screen.getByRole<HTMLButtonElement>("button", {
    name: en.uiPatterns.retry,
  });
  expect(retry.disabled).toBe(false);
  retry.focus();
  const dismissed = screen.getByRole<HTMLButtonElement>("button", {
    name: "Dismissed",
  });
  dismissed.focus();
  expect(document.activeElement).toBe(retry);
  fireEvent.click(dismissed);
  expect(mock.input).toEqual({ state: "PENDING" });

  pendingOutcome = "offline";
  const callsBeforeRetry = pendingCalls.mock.calls.length;
  fireEvent.click(retry);
  await waitFor(() =>
    expect(pendingCalls.mock.calls.length).toBe(callsBeforeRetry + 1),
  );
  await waitFor(() => expect(retry.disabled).toBe(false));
  expectDeniedBoard();

  // Fresh authorized read recovers even with backward clock skew.
  now = Date.UTC(2026, 10, 9, 11, 50);
  historyDenied = false;
  pendingOutcome = "fresh";
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByText("Fresh authorized tutor · Math")).toBeTruthy(),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  for (const choice of within(
    screen.getByRole("region", { name: en.admin.sessionFlags.filterLabel }),
  ).getAllByRole<HTMLButtonElement>("button")) {
    expect(choice.disabled).toBe(false);
  }
  fireEvent.click(dismissed);
  await waitFor(() => expect(mock.input).toEqual({ state: "DISMISSED" }));
  expect(mock.mutate).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
