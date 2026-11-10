/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";
import type { SessionFlagFilter } from "~/lib/session-flag-state";
import { SESSION_FLAG_FILTERS } from "~/lib/session-flag-state";
import en from "../../../messages/en.json";
import { SessionFlagBoard } from "./session-flag-board";
import { SessionViewProvider } from "./session-view-state";

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
  request: undefined as Promise<unknown> | undefined,
  invalidate: vi.fn(),
  readRows: undefined as
    | undefined
    | ((input: { state: string }) => unknown[]),
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
vi.mock("~/trpc/react", async () => {
  const { useQuery, useQueryClient } = await import("@tanstack/react-query");
  return {
  api: {
    useUtils: () => {
      const queryClient = useQueryClient();
      return { admin: { sessionFlags: {
        invalidate: async (
          _input?: undefined,
          filters?: Parameters<typeof queryClient.invalidateQueries>[0],
          options?: Parameters<typeof queryClient.invalidateQueries>[1],
        ) => {
          await mock.invalidate();
          await queryClient.invalidateQueries({ ...filters, queryKey: flagKey() }, options);
        },
      } } };
    },
    admin: {
      sessionFlags: {
        _def: () => ({ path: ["admin", "sessionFlags"] }),
        useQuery: (input: { state: SessionFlagFilter }, options?: { enabled?: boolean }) => {
          mock.input = input;
          const read = useQuery({
            queryKey: flagKey(input),
            queryFn: () => readFlags(input),
            enabled: options?.enabled,
          });
          return {
            ...read,
            refetch: (refetchOptions?: Parameters<typeof read.refetch>[0]) => {
              const request = Promise.resolve(mock.refetch());
              mock.request = request;
              const work = read.refetch(refetchOptions);
              const clear = () => { if (mock.request === request) mock.request = undefined; };
              void work.then(clear, clear);
              return work;
            },
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
  };
});
const flagKey = (input?: { state: SessionFlagFilter }) => input
  ? getQueryKey(api.admin.sessionFlags, input, "query")
  : getQueryKey(api.admin.sessionFlags);
async function readFlags(input: { state: SessionFlagFilter }) {
  if (mock.request) await mock.request;
  if (mock.error) throw Object.assign(new Error(mock.error.message), mock.error);
  return mock.readRows?.(input) ?? mock.data;
}
async function publishRead(input: { state: SessionFlagFilter }) {
  await act(async () => {
    const query = client.getQueryCache().find({ queryKey: flagKey(input), exact: true });
    if (!query) throw new Error("Expected the current flag query");
    const expectedError = mock.error;
    // Query.fetch replaces its options; retain the fixture's configured retry
    // policy just as QueryObserver does when it supplies its complete options.
    await query.fetch({ ...query.options, queryKey: flagKey(input), queryFn: () => readFlags(input) }, {
      cancelRefetch: true,
    }).catch((error: unknown) => {
      if (!expectedError) throw error;
      expect(error).toMatchObject(expectedError);
    });
  });
}
let client: QueryClient;
function seedHealthyFlags() {
  for (const state of SESSION_FLAG_FILTERS) {
    client.setQueryData(flagKey({ state }), mock.readRows?.({ state }) ?? mock.data);
  }
}
const show = () => {
  seedHealthyFlags();
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({ ...defaults, queries: {
    ...defaults.queries, retry: false, gcTime: Infinity,
  } });
  mock.data = [flag];
  mock.error = null;
  mock.mutationError = null;
  mock.readOnly = false;
  mock.pending = false;
  mock.readRows = undefined;
  mock.request = undefined;
  mock.refetch.mockReset().mockResolvedValue(undefined);
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
  act(() => { client.setQueryData(flagKey({ state: "PENALIZED" }), mock.data); });
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
it("retains cached rows beside transport recovery but conceals denied evidence and observer mutations", async () => {
  mock.readOnly = true;
  const view = show();
  expect(
    screen.queryByRole("button", { name: en.admin.sessionFlags.warn }),
  ).toBeNull();
  mock.error = { message: "Offline" };
  await publishRead({ state: "PENDING" });
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Alex · Math")).toBeTruthy();
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  mock.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  await publishRead({ state: "PENDING" });
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Alex · Math")).toBeNull();
  mock.error = { message: "Offline again" };
  await publishRead({ state: "PENDING" });
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Alex · Math")).toBeNull();
  mock.error = null;
  mock.data = [{ ...flag, tutor: "Fresh authorized tutor" }];
  await publishRead({ state: "PENDING" });
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Fresh authorized tutor · Math")).toBeTruthy();
});

it("keeps nondefault-filter denial latched across a cached default and failed retry until a fresh success", async () => {
  window.sessionStorage.clear();
  const remove = vi.spyOn(client, "removeQueries");
  let defaultRows = [{ ...flag, tutor: "Cached pending tutor" }];
  mock.readRows = ({ state }) =>
    state === "PENDING"
      ? defaultRows
      : [{ ...flag, tutor: "Resolved tutor", state: "DISMISSED" }];
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
  seedHealthyFlags();
  const view = render(tree());
  fireEvent.click(screen.getByRole("button", { name: "Dismissed" }));
  expect(screen.getByText("Resolved tutor · Math")).toBeTruthy();
  mock.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  await publishRead({ state: "DISMISSED" });
  view.rerender(tree());
  expect(mock.input).toEqual({ state: "PENDING" });
  expect(screen.queryByText("Resolved tutor · Math")).toBeNull();
  expect(screen.queryByText("Cached pending tutor · Math")).toBeNull();
  expect(remove).toHaveBeenCalledWith({ queryKey: flagKey(), exact: false });

  mock.error = { message: "Offline" };
  await publishRead({ state: "PENDING" });
  view.rerender(tree());
  expect(screen.queryByText("Cached pending tutor · Math")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  expect(mock.refetch).toHaveBeenCalledTimes(1);

  mock.error = null;
  defaultRows = [{ ...flag, tutor: "Fresh authorized tutor" }];
  await publishRead({ state: "PENDING" });
  view.rerender(tree());
  expect(screen.getByText("Fresh authorized tutor · Math")).toBeTruthy();
});
