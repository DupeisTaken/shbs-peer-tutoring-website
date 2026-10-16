// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appealsUseQuery: vi.fn(),
  refetch: vi.fn(),
  settings: vi.fn(),
  role: "HEAD",
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
      feedbackList: { useQuery: () => ({ data: [] }) },
      appeals: { useQuery: state.appealsUseQuery },
      setFeedbackSettings: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      decideAppeal: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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

beforeEach(() => {
  state.role = "HEAD";
  state.settings.mockReturnValue({ data: false, isSuccess: true });
  state.appealsUseQuery.mockReturnValue({ data: { rows: [], total: 0 } });
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
  expect(screen.getByRole("navigation", { name: "staffAppeals" })).toBeTruthy();
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { enabled: true },
  );
  fireEvent.click(screen.getAllByRole("button", { name: "next-0" })[1]!);
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

  fireEvent.click(screen.getByRole("button", { name: "resolvedAppeals" }));
  expect(state.appealsUseQuery).toHaveBeenLastCalledWith(
    { page: 0, state: "RESOLVED" },
    { enabled: true },
  );
});
