// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryClient } from "~/trpc/query-client";
import { api } from "~/trpc/react";

type FeedbackInput = { page: number };
type AppealInput = { page: number; state: "PENDING" | "RESOLVED" };
type FeedbackRow = {
  id: string;
  studentName: string;
  subject: string;
  rating: number;
  body: string;
  updatedAt: Date;
};
type AppealRead = {
  rows: {
    id: string;
    studentName: string;
    state: string;
    cardReason: string;
    body: string;
  }[];
  total: number;
};

const state = vi.hoisted(() => {
  const appealsData: AppealRead = { rows: [], total: 0 };
  return {
    appealsUseQuery:
      vi.fn<(input: AppealInput, options?: { enabled?: boolean }) => void>(),
    feedbackUseQuery: vi.fn<(input: FeedbackInput) => void>(),
    feedbackRefetch: vi.fn<() => Promise<unknown>>(),
    appealsRefetch: vi.fn<() => Promise<unknown>>(),
    refetch: vi.fn(),
    settings: vi.fn(),
    role: "HEAD",
    feedbackError: null as Error | null,
    feedbackBody: "",
    appealsError: null as Error | null,
    appealsData,
    feedbackRows: undefined as
      ((input: FeedbackInput) => FeedbackRow[]) | undefined,
    appealsRows: undefined as ((input: AppealInput) => AppealRead) | undefined,
    feedbackRequest: undefined as Promise<unknown> | undefined,
    appealsRequest: undefined as Promise<unknown> | undefined,
    saveError: null as {
      message: string;
      data?: { approvalId?: string };
    } | null,
    decideError: null as {
      message: string;
      data?: { approvalId?: string };
    } | null,
  };
});

vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({
    dateTime: (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Shanghai",
        ...options,
      }).format(date),
  }),
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      account: { me: { useQuery: () => ({ data: { role: state.role } }) } },
      student: {
        feedbackSettings: { useQuery: state.settings },
        feedbackList: {
          _def: () => ({ path: ["student", "feedbackList"] }),
          useQuery: (input: FeedbackInput, options?: { enabled?: boolean }) => {
            state.feedbackUseQuery(input);
            const read = useQuery({
              queryKey: feedbackKey(input),
              queryFn: () => readFeedback(input),
              initialData: () => feedbackData(input),
              ...options,
            });
            return {
              ...read,
              refetch: (
                refetchOptions?: Parameters<typeof read.refetch>[0],
              ) => {
                const barrier = Promise.resolve(state.feedbackRefetch());
                state.feedbackRequest = barrier;
                const work = read.refetch(refetchOptions);
                const clear = () => {
                  if (state.feedbackRequest === barrier)
                    state.feedbackRequest = undefined;
                };
                void work.then(clear, clear);
                return work;
              },
            };
          },
        },
        appeals: {
          _def: () => ({ path: ["student", "appeals"] }),
          useQuery: (input: AppealInput, options?: { enabled?: boolean }) => {
            state.appealsUseQuery(input, options);
            const read = useQuery({
              queryKey: appealsKey(input),
              queryFn: () => readAppeals(input),
              initialData: () => appealData(input),
              ...options,
            });
            return {
              ...read,
              refetch: (
                refetchOptions?: Parameters<typeof read.refetch>[0],
              ) => {
                const barrier = Promise.resolve(state.appealsRefetch());
                state.appealsRequest = barrier;
                const work = read.refetch(refetchOptions);
                const clear = () => {
                  if (state.appealsRequest === barrier)
                    state.appealsRequest = undefined;
                };
                void work.then(clear, clear);
                return work;
              },
            };
          },
        },
        setFeedbackSettings: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
            error: state.saveError,
          }),
        },
        decideAppeal: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
            error: state.decideError,
          }),
        },
      },
    },
  };
});
vi.mock("./acceptance-records", () => ({ AcceptanceRecords: () => null }));
vi.mock("./school-calendar", () => ({ SchoolCalendar: () => null }));
vi.mock("./confirm-dialog", () => ({
  useDialog: () => ({ promptText: vi.fn(), dialog: null }),
}));
vi.mock("./student-portal", () => ({
  Pager: ({
    page,
    setPage,
    more,
    label,
  }: {
    page: number;
    setPage: (page: number) => void;
    more: boolean;
    label?: string;
  }) => (
    <nav aria-label={label}>
      <button
        type="button"
        aria-label={`next-${page}`}
        disabled={!more}
        onClick={() => setPage(page + 1)}
      />
    </nav>
  ),
}));

import { StudentSupport } from "./student-support";
import { SessionViewProvider } from "./session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";

let client: QueryClient;
const feedbackKey = (input: FeedbackInput) =>
  getQueryKey(api.student.feedbackList, input, "query");
const appealsKey = (input: AppealInput) =>
  getQueryKey(api.student.appeals, input, "query");
function feedbackData(input: FeedbackInput): FeedbackRow[] {
  return (
    state.feedbackRows?.(input) ??
    (state.feedbackBody
      ? [
          {
            id: "review",
            studentName: "Recorded learner",
            subject: "Math",
            rating: 5,
            body: state.feedbackBody,
            updatedAt: new Date("2026-10-01T00:00:00Z"),
          },
        ]
      : [])
  );
}
function appealData(input: AppealInput): AppealRead {
  return state.appealsRows?.(input) ?? state.appealsData;
}
async function readFeedback(input: FeedbackInput): Promise<FeedbackRow[]> {
  if (state.feedbackRequest) await state.feedbackRequest;
  if (state.feedbackError) throw state.feedbackError;
  return feedbackData(input);
}
async function readAppeals(input: AppealInput): Promise<AppealRead> {
  if (state.appealsRequest) await state.appealsRequest;
  if (state.appealsError) throw state.appealsError;
  return appealData(input);
}
function render(children: ReactNode) {
  return renderView(children, {
    wrapper: ({ children: content }) => (
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    ),
  });
}
async function publishFeedback(input: FeedbackInput) {
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: feedbackKey(input),
        queryFn: () => readFeedback(input),
        staleTime: 0,
      })
      .catch((error: unknown) => {
        if (!state.feedbackError) throw error;
        expect(error).toBe(state.feedbackError);
      });
  });
}
async function publishAppeals(input: AppealInput) {
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: appealsKey(input),
        queryFn: () => readAppeals(input),
        staleTime: 0,
      })
      .catch((error: unknown) => {
        if (!state.appealsError) throw error;
        expect(error).toBe(state.appealsError);
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

beforeEach(() => {
  window.sessionStorage.clear();
  state.role = "HEAD";
  state.feedbackError = null;
  state.feedbackBody = "";
  state.appealsError = null;
  state.appealsData = { rows: [], total: 0 };
  state.feedbackRows = undefined;
  state.appealsRows = undefined;
  state.feedbackRequest = undefined;
  state.appealsRequest = undefined;
  state.feedbackRefetch.mockReset().mockResolvedValue(undefined);
  state.appealsRefetch.mockReset().mockResolvedValue(undefined);
  state.feedbackUseQuery.mockReset();
  state.appealsUseQuery.mockReset();
  state.saveError = null;
  state.decideError = null;
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
    },
  });
});
it("clears a denied feed page and conceals cached private feedback instead of restoring it", async () => {
  state.feedbackBody = "Sensitive review body";
  const key = viewStateKey(
    "head",
    "/admin/student-support",
    "support-feedback-page-v1",
    "",
  );
  writeViewState(window.sessionStorage, key, 2);
  const content = () => (
    <SessionViewProvider
      identity="head"
      pathname="/admin/student-support"
      verified
    >
      <StudentSupport />
    </SessionViewProvider>
  );
  render(content());
  expect(screen.getByText("Sensitive review body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "next-2" })).toBeTruthy();
  state.feedbackError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishFeedback({ page: 2 });
  expect(screen.queryByText("Sensitive review body")).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(screen.getByRole("button", { name: "next-0" })).toBeTruthy();
  state.feedbackError = new Error("Network unavailable");
  await publishFeedback({ page: 0 });
  expect(screen.queryByText("Sensitive review body")).toBeNull();
  state.feedbackError = null;
  await publishFeedback({ page: 0 });
  expect(screen.getByText("Sensitive review body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "next-0" })).toBeTruthy();
});
it("drops staff-only panel/filter choices when authoritative account role loses staff access", () => {
  const panelKey = viewStateKey(
    "same-account",
    "/student-support",
    "support-panel-v1",
    "",
  );
  writeViewState(window.sessionStorage, panelKey, "appeals");
  const content = () => (
    <SessionViewProvider
      identity="same-account"
      pathname="/student-support"
      verified
    >
      <StudentSupport />
    </SessionViewProvider>
  );
  const rendered = render(content());
  expect(
    screen
      .getByRole("tab", { name: "staffAppeals" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  state.role = "TUTOR";
  rendered.rerender(content());
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(window.sessionStorage.getItem(panelKey)).toBeNull();
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: false },
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

it.each([undefined, false, true])(
  "does not describe failed visibility as private, including cached %s",
  (data) => {
    state.role = "TUTOR";
    state.settings.mockReturnValue({
      data,
      error: new Error("Offline"),
      refetch: state.refetch,
    });
    render(<StudentSupport />);
    expect(screen.getByText("feedbackVisibilityUnavailable")).toBeTruthy();
    expect(screen.queryByText("privateFeedback")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  },
);
it("distinguishes a pending visibility read from confirmed management-only feedback", () => {
  state.role = "TUTOR";
  state.settings.mockReturnValue({ data: undefined });
  const view = render(<StudentSupport />);
  expect(screen.getByText("feedbackVisibilityLoading")).toBeTruthy();
  expect(screen.queryByText("privateFeedback")).toBeNull();
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  view.rerender(<StudentSupport />);
  expect(screen.getByText("privateFeedback")).toBeTruthy();
});

it("defaults to pending appeals and uses the filtered total for navigation", () => {
  state.appealsData = { rows: [], total: 21 };
  render(<StudentSupport />);

  expect(screen.getByRole("navigation", { name: "feedback" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  expect(screen.getByRole("navigation", { name: "staffAppeals" })).toBeTruthy();
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
  fireEvent.click(screen.getByRole("button", { name: "next-0" }));
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 1, state: "PENDING" },
    { enabled: true },
  );
});

it.each(["PENDING", "RESOLVED"])(
  "labels %s appeal records without leaking server states",
  (stateValue) => {
    state.appealsData = {
      rows: [
        {
          id: "appeal",
          studentName: "Synthetic student",
          state: stateValue,
          cardReason: "Reason",
          body: "Body",
        },
      ],
      total: 1,
    };
    render(<StudentSupport />);
    expect(
      screen.getByText(
        `Synthetic student · ${stateValue === "PENDING" ? "pendingAppeals" : "resolvedAppeals"}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(`Synthetic student · ${stateValue}`)).toBeNull();
  },
);

it("switches to resolved history and resets only the appeal page", () => {
  state.appealsData = { rows: [], total: 1 };
  render(<StudentSupport />);

  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  fireEvent.click(screen.getByRole("button", { name: "resolvedAppeals" }));
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "RESOLVED" },
    { enabled: true },
  );
});

it("retains the appeal page and filter across staff panels", () => {
  state.appealsData = { rows: [], total: 21 };
  render(<StudentSupport />);
  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  fireEvent.click(screen.getByRole("button", { name: "next-0" }));
  fireEvent.click(screen.getByRole("tab", { name: "feedback" }));
  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 1, state: "PENDING" },
    { enabled: true },
  );
});

it.each(["HEAD", "TUTOR"])(
  "keeps feedback read errors visible in the %s Feedback view",
  async (role) => {
    state.role = role;
    state.feedbackError = new Error("Synthetic feedback failure");
    render(<StudentSupport />);
    await publishFeedback({ page: 0 });
    expect(screen.getByRole("alert").textContent).toBe(
      "Synthetic feedback failure",
    );
    if (role === "TUTOR") expect(screen.queryByRole("tablist")).toBeNull();
  },
);
it("keeps sharing write errors visible on the default Feedback panel", () => {
  state.saveError = { message: "Synthetic sharing failure" };
  render(<StudentSupport />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Synthetic sharing failure",
  );
});
it("keeps queued appeal approval feedback visible after leaving Appeals", () => {
  state.decideError = {
    message: "Queued",
    data: { approvalId: "synthetic-approval" },
  };
  render(<StudentSupport />);
  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  fireEvent.click(screen.getByRole("tab", { name: "feedback" }));
  expect(screen.getByRole("status").textContent).toBe("queuedBody");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps denied appeal evidence concealed through transport failures until a successful read", async () => {
  const data = {
    rows: [
      {
        id: "appeal",
        studentName: "Synthetic student",
        state: "RESOLVED",
        cardReason: "Synthetic card reason",
        body: "Private appeal evidence",
      },
    ],
    total: 1,
  };
  state.appealsData = data;
  render(<StudentSupport />);
  expect(screen.getByText("Private appeal evidence")).toBeTruthy();
  state.appealsError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishAppeals({ page: 0, state: "PENDING" });
  expect(screen.queryByText("Private appeal evidence")).toBeNull();
  state.appealsError = new Error("Network unavailable");
  await publishAppeals({ page: 0, state: "PENDING" });
  expect(screen.queryByText("Private appeal evidence")).toBeNull();
  state.appealsError = null;
  await publishAppeals({ page: 0, state: "PENDING" });
  expect(screen.getByText("Private appeal evidence")).toBeTruthy();
});

it("keeps feedback concealed when denial resets its page to an older successful cache entry", async () => {
  state.feedbackRows = ({ page }) => [
    {
      id: `feedback-${page}`,
      studentName: "Synthetic learner",
      subject: "Math",
      rating: 5,
      body: page === 1 ? "Second-page feedback" : "First-page feedback",
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    },
  ];
  client.setQueryData(feedbackKey({ page: 0 }), feedbackData({ page: 0 }));
  const key = viewStateKey(
    "head",
    "/admin/student-support",
    "support-feedback-page-v1",
    "",
  );
  writeViewState(window.sessionStorage, key, 1);
  const content = () => (
    <SessionViewProvider
      identity="head"
      pathname="/admin/student-support"
      verified
    >
      <StudentSupport />
    </SessionViewProvider>
  );
  render(content());
  expect(screen.getByText("Second-page feedback")).toBeTruthy();
  state.feedbackError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishFeedback({ page: 1 });
  expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(screen.queryByText("Second-page feedback")).toBeNull();
  expect(screen.queryByText("First-page feedback")).toBeNull();
  const recovery = deferred();
  state.feedbackRefetch.mockReturnValueOnce(recovery.promise);
  state.feedbackError = null;
  fireEvent.click(screen.getByRole("button", { name: "feedback · retry" }));
  expect(state.feedbackRefetch).toHaveBeenCalledOnce();
  expect(state.appealsRefetch).not.toHaveBeenCalled();
  expect(screen.queryByText("First-page feedback")).toBeNull();
  // Updating an equal cached value cannot authorize a feed while its read waits.
  await act(async () => {
    client.setQueryData(feedbackKey({ page: 0 }), feedbackData({ page: 0 }));
  });
  expect(screen.queryByText("First-page feedback")).toBeNull();
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText("First-page feedback")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "feedback · retry",
    }).disabled,
  ).toBe(true);
  await act(async () => {
    recovery.resolve();
  });
  await waitFor(() =>
    expect(screen.getByText("First-page feedback")).toBeTruthy(),
  );
  expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
});

it("keeps appeals concealed when denial resets page and filter to an older successful cache entry", async () => {
  state.appealsRows = ({ page, state: filter }) => {
    return {
      rows: [
        {
          id: `appeal-${filter}-${page}`,
          studentName: "Synthetic learner",
          state: filter,
          cardReason: "Synthetic card reason",
          body: `${filter} appeal evidence`,
        },
      ],
      total: 21,
    };
  };
  client.setQueryData(
    appealsKey({ page: 0, state: "PENDING" }),
    appealData({ page: 0, state: "PENDING" }),
  );
  for (const [id, value] of [
    ["support-panel-v1", "appeals"],
    ["support-appeal-page-v1", 1],
    ["support-appeal-filter-v1", "RESOLVED"],
  ] as const)
    writeViewState(
      window.sessionStorage,
      viewStateKey("head", "/admin/student-support", id, ""),
      value,
    );
  const content = () => (
    <SessionViewProvider
      identity="head"
      pathname="/admin/student-support"
      verified
    >
      <StudentSupport />
    </SessionViewProvider>
  );
  render(content());
  expect(screen.getByText("RESOLVED appeal evidence")).toBeTruthy();
  state.appealsError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  await publishAppeals({ page: 1, state: "RESOLVED" });
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
  expect(screen.queryByText("RESOLVED appeal evidence")).toBeNull();
  expect(screen.queryByText("PENDING appeal evidence")).toBeNull();
  // The appeal panel has reset to Feedback, but this read-only recovery stays visible.
  const recovery = deferred();
  state.appealsRefetch.mockReturnValueOnce(recovery.promise);
  state.appealsError = null;
  fireEvent.click(screen.getByRole("button", { name: "staffAppeals · retry" }));
  expect(state.appealsRefetch).toHaveBeenCalledOnce();
  expect(state.feedbackRefetch).not.toHaveBeenCalled();
  expect(screen.queryByText("PENDING appeal evidence")).toBeNull();
  await act(async () => {
    recovery.resolve();
  });
  await waitFor(() =>
    expect(screen.getByText("PENDING appeal evidence")).toBeTruthy(),
  );
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
});
