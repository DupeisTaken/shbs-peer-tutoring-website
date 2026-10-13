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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { SessionFlagBoard } from "./session-flag-board";

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
  invalidate: vi.fn(),
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
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["flags"] }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { sessionFlags: { invalidate: mock.invalidate } },
    }),
    admin: {
      sessionFlags: {
        useQuery: (input: unknown) => {
          mock.input = input;
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.data = [flag];
  mock.error = null;
  mock.mutationError = null;
  mock.readOnly = false;
  mock.pending = false;
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
it("retains cached rows beside transport recovery but conceals denied evidence and observer mutations", () => {
  mock.readOnly = true;
  const view = show();
  expect(
    screen.queryByRole("button", { name: en.admin.sessionFlags.warn }),
  ).toBeNull();
  mock.error = { message: "Offline" };
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
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Alex · Math")).toBeNull();
  mock.error = { message: "Offline again" };
  view.rerender(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SessionFlagBoard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Alex · Math")).toBeNull();
});
