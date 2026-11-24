// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryClient } from "~/trpc/query-client";

const state = vi.hoisted(() => ({
  realQueries: false,
  appealsUseQuery:
    vi.fn<
      (
        input: { page: number; state: string },
        options?: { enabled?: boolean },
      ) => unknown
    >(),
  feedbackUseQuery: vi.fn<(input: { page: number }) => unknown>(),
  feedbackQueryFn: undefined as
    undefined | ((input: { page: number }) => Promise<unknown>),
  appealsQueryFn: undefined as
    undefined | ((input: { page: number; state: string }) => Promise<unknown>),
  feedbackRefetch: vi.fn(),
  appealsRefetch: vi.fn(),
  refetch: vi.fn(),
  settings: vi.fn(),
  role: "HEAD",
  feedbackError: null as Error | null,
  feedbackBody: "",
  saveError: null as { message: string; data?: { approvalId?: string } } | null,
  decideError: null as {
    message: string;
    data?: { approvalId?: string };
  } | null,
}));

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
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: { role: state.role } }) } },
    student: {
      feedbackSettings: { useQuery: state.settings },
      feedbackList: {
        useQuery: (
          input: { page: number },
          options?: { enabled?: boolean },
        ) => {
          const mockResult = state.realQueries
            ? undefined
            : state.feedbackUseQuery(input);
          if (state.realQueries) state.feedbackUseQuery(input);
          const live = useQuery(
            {
              queryKey: [["student", "feedbackList"], { input, type: "query" }],
              queryFn: async () => {
                state.feedbackRefetch();
                if (state.feedbackQueryFn) return state.feedbackQueryFn(input);
                if (state.feedbackError) throw state.feedbackError;
                return state.feedbackBody
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
                  : [];
              },
              enabled: state.realQueries && options?.enabled !== false,
            },
            queryClient,
          );
          if (state.realQueries) return live;
          return (
            mockResult ?? {
              data: state.feedbackBody
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
                : [],
              error: state.feedbackError,
              refetch: state.feedbackRefetch,
              isSuccess: !state.feedbackError,
              isFetching: false,
            }
          );
        },
      },
      appeals: {
        useQuery: (
          input: { page: number; state: string },
          options?: { enabled?: boolean },
        ) => {
          const mockResult = state.realQueries
            ? undefined
            : state.appealsUseQuery(input, options);
          if (state.realQueries) state.appealsUseQuery(input, options);
          const live = useQuery(
            {
              queryKey: [["student", "appeals"], { input, type: "query" }],
              queryFn: async () => {
                state.appealsRefetch();
                if (state.appealsQueryFn) return state.appealsQueryFn(input);
                return { rows: [], total: 0 };
              },
              enabled: state.realQueries && options?.enabled !== false,
            },
            queryClient,
          );
          if (state.realQueries) return live;
          return mockResult;
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
}));
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

let queryClient: QueryClient;
const withClient = (node: React.ReactNode) => (
  <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
);

beforeEach(() => {
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
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
  window.sessionStorage.clear();
  state.realQueries = false;
  state.feedbackQueryFn = undefined;
  state.appealsQueryFn = undefined;
  state.role = "HEAD";
  state.feedbackError = null;
  state.feedbackBody = "";
  state.feedbackUseQuery.mockReset();
  state.saveError = null;
  state.decideError = null;
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  state.appealsUseQuery.mockReturnValue({
    data: { rows: [], total: 0 },
    refetch: state.appealsRefetch,
  });
});
it("clears a denied feed page and conceals cached private feedback instead of restoring it", async () => {
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  state.feedbackBody = "Sensitive review body";
  const key = viewStateKey(
    "head",
    "/admin/student-support",
    "support-feedback-page-v1",
    "",
  );
  writeViewState(window.sessionStorage, key, 2);
  render(
    withClient(
      <SessionViewProvider
        identity="head"
        pathname="/admin/student-support"
        verified
      >
        <StudentSupport />
      </SessionViewProvider>,
    ),
  );
  await waitFor(() =>
    expect(screen.getByText("Sensitive review body")).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "next-2" })).toBeTruthy();

  now = Date.UTC(2026, 10, 9, 12, 0);
  state.feedbackError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [
        ["student", "feedbackList"],
        { input: { page: 2 }, type: "query" },
      ],
    });
  });
  await waitFor(() =>
    expect(screen.queryByText("Sensitive review body")).toBeNull(),
  );
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(screen.getByRole("button", { name: "next-0" })).toBeTruthy();

  state.feedbackError = new Error("Network unavailable");
  fireEvent.click(screen.getByRole("button", { name: "feedback · retry" }));
  await waitFor(() =>
    expect(screen.queryByText("Sensitive review body")).toBeNull(),
  );

  now = Date.UTC(2026, 10, 9, 11, 50);
  state.feedbackError = null;
  fireEvent.click(screen.getByRole("button", { name: "feedback · retry" }));
  await waitFor(() =>
    expect(screen.getByText("Sensitive review body")).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "next-0" })).toBeTruthy();
  vi.restoreAllMocks();
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
  state.appealsUseQuery.mockReturnValue({
    data: { rows: [], total: 21 },
    refetch: state.refetch,
  });
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
    state.appealsUseQuery.mockReturnValue({
      data: {
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
      },
    });
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
  state.appealsUseQuery.mockReturnValue({
    data: { rows: [], total: 1 },
    refetch: state.refetch,
  });
  render(<StudentSupport />);

  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  fireEvent.click(screen.getByRole("button", { name: "resolvedAppeals" }));
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "RESOLVED" },
    { enabled: true },
  );
});

it("retains the appeal page and filter across staff panels", () => {
  state.appealsUseQuery.mockReturnValue({ data: { rows: [], total: 21 } });
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
  (role) => {
    state.role = role;
    state.feedbackError = new Error("Synthetic feedback failure");
    render(<StudentSupport />);
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
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
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
  let error: Error | null = null;
  state.appealsQueryFn = async () => {
    if (error) throw error;
    return data;
  };
  render(withClient(<StudentSupport />));
  await waitFor(() =>
    expect(screen.getByText("Private appeal evidence")).toBeTruthy(),
  );

  now = Date.UTC(2026, 10, 9, 12, 0);
  error = Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["student", "appeals"]],
    });
  });
  await waitFor(() =>
    expect(screen.queryByText("Private appeal evidence")).toBeNull(),
  );

  error = new Error("Network unavailable");
  fireEvent.click(screen.getByRole("button", { name: "staffAppeals · retry" }));
  await waitFor(() =>
    expect(screen.queryByText("Private appeal evidence")).toBeNull(),
  );

  now = Date.UTC(2026, 10, 9, 11, 50);
  error = null;
  fireEvent.click(screen.getByRole("button", { name: "staffAppeals · retry" }));
  await waitFor(() =>
    expect(screen.getByText("Private appeal evidence")).toBeTruthy(),
  );
  vi.restoreAllMocks();
});

it("keeps feedback concealed when denial resets its page to an older successful cache entry", async () => {
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let denyPageOne = false;
  let releaseFirstPage: (() => void) | undefined;
  let holdFirstPage = false;
  state.feedbackQueryFn = async ({ page }) => {
    if (page === 1 && denyPageOne) {
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    }
    if (page === 0 && holdFirstPage) {
      await new Promise<void>((resolve) => {
        releaseFirstPage = resolve;
      });
    }
    return Array.from({ length: page === 0 ? 20 : 1 }, (_, index) => ({
      id: `feedback-${page}-${index}`,
      studentName: "Synthetic learner",
      subject: "Math",
      rating: 5,
      body:
        index === 0
          ? page === 1
            ? "Second-page feedback"
            : "First-page feedback"
          : `Page ${page} item ${index}`,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    }));
  };
  const key = viewStateKey(
    "head",
    "/admin/student-support",
    "support-feedback-page-v1",
    "",
  );
  // Seed page 0 first with a future-skewed timestamp, then navigate to page 1.
  render(
    withClient(
      <SessionViewProvider
        identity="head"
        pathname="/admin/student-support"
        verified
      >
        <StudentSupport />
      </SessionViewProvider>,
    ),
  );
  await waitFor(() =>
    expect(screen.getByText("First-page feedback")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "next-0" }));
  await waitFor(() =>
    expect(screen.getByText("Second-page feedback")).toBeTruthy(),
  );

  // Move clock backward and deny page 1; reset back to cached page 0 must stay concealed.
  now = Date.UTC(2026, 10, 9, 12, 0);
  denyPageOne = true;
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [
        ["student", "feedbackList"],
        { input: { page: 1 }, type: "query" },
      ],
    });
  });
  await waitFor(() => {
    expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(screen.queryByText("Second-page feedback")).toBeNull();
    expect(screen.queryByText("First-page feedback")).toBeNull();
  });

  // Explicit Retry starts a fresh read on page 0; while fetching, retry is disabled
  // and cached content remains concealed.
  now = Date.UTC(2026, 10, 9, 11, 50);
  holdFirstPage = true;
  const callsBefore = state.feedbackRefetch.mock.calls.length;
  const appealsBefore = state.appealsRefetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "feedback · retry" }));
  await waitFor(() =>
    expect(state.feedbackRefetch.mock.calls.length).toBe(callsBefore + 1),
  );
  expect(state.appealsRefetch.mock.calls.length).toBe(appealsBefore);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "feedback · retry" })
      .disabled,
  ).toBe(true);
  expect(screen.queryByText("First-page feedback")).toBeNull();

  holdFirstPage = false;
  releaseFirstPage?.();
  await waitFor(() =>
    expect(screen.getByText("First-page feedback")).toBeTruthy(),
  );
  expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
  vi.restoreAllMocks();
});

it("keeps appeals concealed when denial resets page and filter to an older successful cache entry", async () => {
  state.realQueries = true;
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let denyResolvedPage = false;
  state.appealsQueryFn = async ({ page, state: filter }) => {
    if (denyResolvedPage && page === 1 && filter === "RESOLVED") {
      throw Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } });
    }
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
  render(
    withClient(
      <SessionViewProvider
        identity="head"
        pathname="/admin/student-support"
        verified
      >
        <StudentSupport />
      </SessionViewProvider>,
    ),
  );
  // Seed default PENDING page 0 with a future-skewed timestamp.
  fireEvent.click(screen.getByRole("tab", { name: "staffAppeals" }));
  await waitFor(() =>
    expect(screen.getByText("PENDING appeal evidence")).toBeTruthy(),
  );
  // Move to RESOLVED page 1.
  fireEvent.click(screen.getByRole("button", { name: "resolvedAppeals" }));
  await waitFor(() =>
    expect(screen.getByText("RESOLVED appeal evidence")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "next-0" }));
  await waitFor(() =>
    expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
      { page: 1, state: "RESOLVED" },
      { enabled: true },
    ),
  );

  // Deny RESOLVED page 1 under a backward wall clock.
  now = Date.UTC(2026, 10, 9, 12, 0);
  denyResolvedPage = true;
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [
        ["student", "appeals"],
        { input: { page: 1, state: "RESOLVED" }, type: "query" },
      ],
    });
  });
  await waitFor(() => {
    expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
      { page: 0, state: "PENDING" },
      { enabled: false },
    );
    expect(screen.queryByText("RESOLVED appeal evidence")).toBeNull();
    expect(screen.queryByText("PENDING appeal evidence")).toBeNull();
  });

  // The appeal panel has reset to Feedback, but this read-only recovery stays visible.
  now = Date.UTC(2026, 10, 9, 11, 50);
  const feedbackBefore = state.feedbackRefetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "staffAppeals · retry" }));
  await waitFor(() =>
    expect(screen.getByText("PENDING appeal evidence")).toBeTruthy(),
  );
  expect(state.feedbackRefetch.mock.calls.length).toBe(feedbackBefore);
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
  vi.restoreAllMocks();
});
