// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appealsUseQuery: vi.fn(),
  feedbackUseQuery: vi.fn<(input: { page: number }) => unknown>(),
  feedbackRefetch: vi.fn(),
  appealsRefetch: vi.fn(),
  refetch: vi.fn(),
  settings: vi.fn(),
  role: "HEAD",
  feedbackError: null as Error | null,
  feedbackBody: "",
  feedbackUpdatedAt: 1,
  feedbackErrorUpdatedAt: 0,
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
        useQuery: (input: { page: number }) => state.feedbackUseQuery(input) ?? ({
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
          dataUpdatedAt: state.feedbackUpdatedAt,
          errorUpdatedAt: state.feedbackErrorUpdatedAt,
          refetch: state.feedbackRefetch,
          isSuccess: !state.feedbackError,
          isFetching: false,
        }),
      },
      appeals: { useQuery: state.appealsUseQuery },
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

beforeEach(() => {
  window.sessionStorage.clear();
  state.role = "HEAD";
  state.feedbackError = null;
  state.feedbackBody = "";
  state.feedbackUpdatedAt = 1;
  state.feedbackErrorUpdatedAt = 0;
  state.feedbackUseQuery.mockReset();
  state.saveError = null;
  state.decideError = null;
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  state.appealsUseQuery.mockReturnValue({
    data: { rows: [], total: 0 },
    refetch: state.appealsRefetch,
  });
});
it("clears a denied feed page and conceals cached private feedback instead of restoring it", () => {
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
  const rendered = render(content());
  expect(screen.getByText("Sensitive review body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "next-2" })).toBeTruthy();
  state.feedbackError = Object.assign(new Error("Denied"), {
    data: { code: "FORBIDDEN" },
  });
  state.feedbackErrorUpdatedAt = 2;
  rendered.rerender(content());
  expect(screen.queryByText("Sensitive review body")).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(screen.getByRole("button", { name: "next-0" })).toBeTruthy();
  state.feedbackError = new Error("Network unavailable");
  rendered.rerender(content());
  expect(screen.queryByText("Sensitive review body")).toBeNull();
  state.feedbackError = null;
  state.feedbackUpdatedAt = 3;
  rendered.rerender(content());
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


it("keeps denied appeal evidence concealed through transport failures until a successful read", () => {
  const data = {
    rows: [{
      id: "appeal",
      studentName: "Synthetic student",
      state: "RESOLVED",
      cardReason: "Synthetic card reason",
      body: "Private appeal evidence",
    }],
    total: 1,
  };
  const result = {
    data,
    isSuccess: true,
    isFetching: false,
    error: null,
    dataUpdatedAt: 1,
    errorUpdatedAt: 0,
  };
  state.appealsUseQuery.mockReturnValue(result);
  const view = render(<StudentSupport />);
  expect(screen.getByText("Private appeal evidence")).toBeTruthy();
  state.appealsUseQuery.mockReturnValue({
    ...result,
    isSuccess: false,
    error: { message: "Denied", data: { code: "FORBIDDEN" } },
    errorUpdatedAt: 2,
  });
  view.rerender(<StudentSupport />);
  expect(screen.queryByText("Private appeal evidence")).toBeNull();
  state.appealsUseQuery.mockReturnValue({
    ...result,
    isSuccess: false,
    error: new Error("Network unavailable"),
  });
  view.rerender(<StudentSupport />);
  expect(screen.queryByText("Private appeal evidence")).toBeNull();
  state.appealsUseQuery.mockReturnValue({ ...result, dataUpdatedAt: 3 });
  view.rerender(<StudentSupport />);
  expect(screen.getByText("Private appeal evidence")).toBeTruthy();
});


it("keeps feedback concealed when denial resets its page to an older successful cache entry", () => {
  let denyPageOne = false;
  let firstPageUpdatedAt = 20;
  let fetching = false;
  state.feedbackUseQuery.mockImplementation(({ page }: { page: number }) => ({
    data: [{
      id: `feedback-${page}`,
      studentName: "Synthetic learner",
      subject: "Math",
      rating: 5,
      body: page === 1 ? "Second-page feedback" : "First-page feedback",
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    }],
    error: page === 1 && denyPageOne
      ? { message: "Denied", data: { code: "FORBIDDEN" } }
      : null,
    isSuccess: !(page === 1 && denyPageOne),
    isFetching: fetching,
    dataUpdatedAt: page === 1 ? 10 : firstPageUpdatedAt,
    errorUpdatedAt: page === 1 && denyPageOne ? 100 : 0,
    refetch: state.feedbackRefetch,
  }));
  const key = viewStateKey("head", "/admin/student-support", "support-feedback-page-v1", "");
  writeViewState(window.sessionStorage, key, 1);
  const content = () => (
    <SessionViewProvider identity="head" pathname="/admin/student-support" verified>
      <StudentSupport />
    </SessionViewProvider>
  );
  const view = render(content());
  expect(screen.getByText("Second-page feedback")).toBeTruthy();
  denyPageOne = true;
  view.rerender(content());
  expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(screen.queryByText("Second-page feedback")).toBeNull();
  expect(screen.queryByText("First-page feedback")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "feedback · retry" }));
  expect(state.feedbackRefetch).toHaveBeenCalledOnce();
  expect(state.appealsRefetch).not.toHaveBeenCalled();
  expect(screen.queryByText("First-page feedback")).toBeNull();
  firstPageUpdatedAt = 100;
  view.rerender(content());
  expect(screen.queryByText("First-page feedback")).toBeNull();
  firstPageUpdatedAt = 101;
  fetching = true;
  view.rerender(content());
  expect(screen.queryByText("First-page feedback")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", {
    name: "feedback · retry",
  }).disabled).toBe(true);
  fetching = false;
  view.rerender(content());
  expect(screen.getByText("First-page feedback")).toBeTruthy();
  expect(state.feedbackUseQuery).toHaveBeenLastCalledWith({ page: 0 });
});

it("keeps appeals concealed when denial resets page and filter to an older successful cache entry", () => {
  let denyResolvedPage = false;
  let pendingUpdatedAt = 20;
  state.appealsUseQuery.mockImplementation(({ page, state: filter }: { page: number; state: string }) => {
    const denied = denyResolvedPage && page === 1 && filter === "RESOLVED";
    return {
      data: {
        rows: [{
          id: `appeal-${filter}-${page}`,
          studentName: "Synthetic learner",
          state: filter,
          cardReason: "Synthetic card reason",
          body: `${filter} appeal evidence`,
        }],
        total: 21,
      },
      error: denied ? { message: "Denied", data: { code: "FORBIDDEN" } } : null,
      isSuccess: !denied,
      isFetching: false,
      dataUpdatedAt: filter === "RESOLVED" ? 10 : pendingUpdatedAt,
      errorUpdatedAt: denied ? 100 : 0,
      refetch: state.appealsRefetch,
    };
  });
  for (const [id, value] of [
    ["support-panel-v1", "appeals"],
    ["support-appeal-page-v1", 1],
    ["support-appeal-filter-v1", "RESOLVED"],
  ] as const)
    writeViewState(window.sessionStorage, viewStateKey("head", "/admin/student-support", id, ""), value);
  const content = () => (
    <SessionViewProvider identity="head" pathname="/admin/student-support" verified>
      <StudentSupport />
    </SessionViewProvider>
  );
  const view = render(content());
  expect(screen.getByText("RESOLVED appeal evidence")).toBeTruthy();
  denyResolvedPage = true;
  view.rerender(content());
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
  expect(screen.queryByText("RESOLVED appeal evidence")).toBeNull();
  expect(screen.queryByText("PENDING appeal evidence")).toBeNull();
  // The appeal panel has reset to Feedback, but this read-only recovery stays visible.
  fireEvent.click(screen.getByRole("button", { name: "staffAppeals · retry" }));
  expect(state.appealsRefetch).toHaveBeenCalledOnce();
  expect(state.feedbackRefetch).not.toHaveBeenCalled();
  expect(screen.queryByText("PENDING appeal evidence")).toBeNull();
  pendingUpdatedAt = 101;
  view.rerender(content());
  expect(screen.getByText("PENDING appeal evidence")).toBeTruthy();
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
});
