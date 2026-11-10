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
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import SessionFlagsPage from "../(admin)/admin/session-flags/page";
import ServiceHoursPage from "../(admin)/admin/service-hours/(roster)/page";
import { ReadOnlyProvider } from "./read-only";

vi.mock("./school-hours-panel", () => ({ SchoolHoursPanel: () => null }));

const state = vi.hoisted(() => ({
  empty: false,
  pending: false,
  readError: null as null | { message: string; data?: { code: string } },
  writeError: null as null | { message: string; data?: { approvalId: string } },
  retry: vi.fn<() => Promise<unknown>>(),
  request: undefined as Promise<unknown> | undefined,
  lastRefetch: undefined as Promise<unknown> | undefined,
  decide: vi.fn(),
  summary: vi.fn(),
  failed: undefined as
    | undefined
    | ((
        error: { data?: { approvalId?: string } },
        input: { flagId: string },
      ) => void),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({ admin: { sessionFlags: { invalidate: vi.fn() } } }),
      admin: {
        periodSummary: {
          _def: () => ({ path: ["admin", "periodSummary"] }),
          useQuery: (input: unknown) => {
            state.summary(input);
            return {
              data: {
                scope: { label: "Synthetic semester" },
                rows: [],
                totals: { earned: 0, extras: 0, punishments: 0, total: 0 },
              },
            };
          },
        },
        sessionFlags: {
          _def: () => ({ path: ["admin", "sessionFlags"] }),
          useQuery: (
            input: { state: SessionFlagFilter },
            options?: { enabled?: boolean },
          ) => {
            const read = useQuery({
              queryKey: flagKey(input),
              queryFn: readFlags,
              ...options,
            });
            return {
              ...read,
              refetch: (
                refetchOptions?: Parameters<typeof read.refetch>[0],
              ) => {
                const request = state.retry();
                state.request = request;
                const work = read.refetch(refetchOptions);
                state.lastRefetch = work;
                const clear = () => {
                  if (state.request === request) state.request = undefined;
                };
                void work.then(clear, clear);
                return work;
              },
            };
          },
        },
        decideSessionFlag: {
          useMutation: (options: { onError: typeof state.failed }) => {
            state.failed = options.onError;
            return {
              mutate: state.decide,
              isPending: state.pending,
              error: state.writeError,
              reset: () => {
                state.writeError = null;
              },
            };
          },
        },
      },
    },
  };
});
const flagKey = (input: { state: SessionFlagFilter } = { state: "PENDING" }) =>
  getQueryKey(api.admin.sessionFlags, input, "query");
function flagData() {
  return state.empty
    ? []
    : [
        {
          id: "flag",
          tutor: "Synthetic Tutor",
          subject: "Synthetic Subject",
          observed: 1,
          expected: 2,
          room: "Synthetic Room",
          date: new Date("2026-10-01T00:00:00Z"),
          startMin: 900,
          endMin: 960,
          state: "PENDING",
          decisionNote: null,
          resolvedAt: null,
          resolvedByName: null,
        },
      ];
}
async function readFlags() {
  if (state.request) await state.request;
  if (state.readError)
    throw Object.assign(new Error(state.readError.message), state.readError);
  return flagData();
}
async function publishFlags() {
  await act(async () => {
    await client
      .fetchQuery({ queryKey: flagKey(), queryFn: readFlags, staleTime: 0 })
      .catch((error: unknown) => {
        if (!state.readError) throw error;
        expect(error).toMatchObject(state.readError);
      });
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let client: QueryClient;
beforeEach(() => {
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: Infinity,
      gcTime: Infinity,
    },
  });
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
  state.empty = false;
  state.pending = false;
  state.readError = null;
  state.writeError = null;
  vi.clearAllMocks();
  state.retry.mockReset().mockResolvedValue(undefined);
  state.request = undefined;
  state.lastRefetch = undefined;
  // Healthy presentation cases need no read; this seed never issues proof.
  client.setQueryData(flagKey(), flagData());
});
afterEach(() => {
  cleanup();
  client.clear();
});

const flags = (readOnly = false) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <ReadOnlyProvider value={readOnly}>
        <SessionFlagsPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);

it("separates unknown, failed, denied and successfully empty flag reads", async () => {
  const initial = deferred();
  state.request = initial.promise;
  client.removeQueries({ queryKey: flagKey(), exact: true });
  const initialRead = client.fetchQuery({
    queryKey: flagKey(),
    queryFn: readFlags,
    staleTime: 0,
  });
  void initialRead.catch(() => undefined);
  const view = render(flags());
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  const initialFailure = { message: "Synthetic read failure" };
  state.readError = initialFailure;
  await act(async () => {
    initial.resolve();
    await expect(initialRead).rejects.toMatchObject(initialFailure);
  });
  state.request = undefined;
  view.rerender(flags());
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic read failure",
  );
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  const denial = deferred();
  state.retry.mockReturnValueOnce(denial.promise);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.readError = {
    message: "Synthetic access denial",
    data: { code: "FORBIDDEN" },
  };
  await act(async () => {
    denial.resolve();
    await state.lastRefetch;
  });
  // The feature evicts its first denied Query. A real denied read on the
  // replacement keeps the original detailed-error assertion meaningful.
  await publishFlags();
  view.rerender(flags());
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
  expect(screen.getByRole("status").textContent).toContain(
    "Synthetic access denial",
  );
  state.readError = null;
  state.empty = true;
  await publishFlags();
  view.rerender(flags());
  expect(screen.getByText(en.admin.sessionFlags.empty)).toBeTruthy();
});

it("retains review inputs through pending writes and read/write failures, then retries the same decision", async () => {
  const view = render(flags());
  // Drafts now belong to the on-demand decision dialog; opening is read-only.
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.penalize }),
  );
  const note = screen.getByRole<HTMLInputElement>("textbox", {
    name: en.admin.sessionFlags.notePlaceholder,
  });
  const hours = screen.getByRole<HTMLInputElement>("spinbutton", {
    name: en.admin.sessionFlags.penaltyHours,
  });
  fireEvent.change(note, { target: { value: "Synthetic review note" } });
  fireEvent.change(hours, { target: { value: "1.25" } });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.admin.sessionFlags.penalize,
    }),
  );
  expect(state.decide).toHaveBeenCalledExactlyOnceWith({
    flagId: "flag",
    action: "PENALIZE",
    note: "Synthetic review note",
    penaltyHours: 1.25,
  });
  state.pending = true;
  view.rerender(flags());
  expect(note.matches(":disabled")).toBe(true);
  expect(hours.matches(":disabled")).toBe(true);
  state.pending = false;
  state.writeError = { message: "Synthetic rejected write" };
  act(() => state.failed?.(state.writeError!, { flagId: "flag" }));
  state.readError = { message: "Synthetic failed refresh" };
  await publishFlags();
  view.rerender(flags());
  expect(note.value).toBe("Synthetic review note");
  expect(hours.value).toBe("1.25");
  expect(note.matches(":disabled")).toBe(true);
  expect(screen.queryByText(en.admin.sessionFlags.empty)).toBeNull();
  state.readError = null;
  await publishFlags();
  view.rerender(flags());
  expect(note.matches(":disabled")).toBe(false);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.admin.sessionFlags.penalize,
    }),
  );
  expect(state.decide).toHaveBeenCalledTimes(2);
  expect(state.decide.mock.calls[1]).toEqual(state.decide.mock.calls[0]);
});

it("reports a queued proposal without calling it an applied decision or discarding its note", () => {
  const view = render(flags());
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.sessionFlags.warn }),
  );
  const note = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(note, { target: { value: "Retained proposal note" } });
  state.writeError = {
    message: "Transport error",
    data: { approvalId: "proposal" },
  };
  act(() => state.failed?.(state.writeError!, { flagId: "flag" }));
  view.rerender(flags());
  expect(screen.getByRole("status").textContent).toBe(
    en.admin.sessionFlags.queued,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(note.value).toBe("Retained proposal note");
});

it("keeps viewer records readable without review inputs or mutation actions", () => {
  render(flags(true));
  expect(screen.getByText(/Synthetic Tutor/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.admin.sessionFlags.penalize }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Pending" })).toBeTruthy();
  expect(state.decide).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "keeps the %s month filter native, labelled and reversible beside its history link",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={messages}
        >
          <ServiceHoursPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const month = screen.getByLabelText<HTMLInputElement>(
      messages.admin.summary.monthLabel,
      { selector: "input" },
    );
    fireEvent.change(month, { target: { value: "2026-10" } });
    expect(state.summary).toHaveBeenLastCalledWith({ month: "2026-10" });
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.summary.clearMonth }),
    );
    expect(state.summary).toHaveBeenLastCalledWith(undefined);
    expect(month.value).toBe("");
    expect(
      screen
        .getByRole("link", { name: messages.admin.summary.viewHistory })
        .getAttribute("href"),
    ).toBe("/admin/history");
  },
);
