// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appealsUseQuery: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
    student: {
      feedbackSettings: { useQuery: () => ({ data: false, isSuccess: true }) },
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
  }: {
    page: number;
    setPage: (page: number) => void;
    more: boolean;
  }) => (
    <button
      type="button"
      aria-label={`next-${page}`}
      disabled={!more}
      onClick={() => setPage(page + 1)}
    />
  ),
}));

import { StudentSupport } from "./student-support";

afterEach(() => {
  vi.clearAllMocks();
});

it("defaults to pending appeals and uses the filtered total for navigation", () => {
  state.appealsUseQuery.mockReturnValue({
    data: { rows: [], total: 21 },
    refetch: state.refetch,
  });
  render(<StudentSupport />);

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
