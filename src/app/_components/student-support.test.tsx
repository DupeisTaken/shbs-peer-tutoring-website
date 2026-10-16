// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appealsUseQuery: vi.fn(),
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
        useQuery: () => ({
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
  state.saveError = null;
  state.decideError = null;
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  state.appealsUseQuery.mockReturnValue({ data: { rows: [], total: 0 } });
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
  rendered.rerender(content());
  expect(screen.queryByText("Sensitive review body")).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBeNull();
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
