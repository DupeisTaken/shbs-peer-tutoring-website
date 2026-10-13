// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { StudentWithdrawals } from "./student-withdrawals";
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  loaded: true,
  error: null as null | { message: string; data?: { code?: string } },
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["withdrawal-test"],
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Sep 12, 2026, 14:30" }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    studentWorkflow: {
      adminRequests: {
        useQuery: () => ({
          error: mocks.error,
          isSuccess: mocks.loaded && !mocks.error,
          isFetching: false,
          data: mocks.loaded
            ? [
                {
                  name: "Survey Student",
                  reviews: [
                    {
                      id: "survey-review",
                      kind: "STUDENT_ABORT",
                      state: "PENDING",
                      createdAt: new Date(),
                      reason: "Personal reason",
                    },
                  ],
                },
              ]
            : undefined,
        }),
      },
      legacyReviews: {
        useQuery: () => ({
          data: [
            {
              id: "manual-review",
              name: "Manual Student",
              kind: "STUDENT_ABORT",
              state: "PENDING",
              createdAt: new Date(),
              reason: "Schedule changed",
            },
            {
              id: "schedule-review",
              name: "Schedule Only",
              kind: "SCHEDULE_CONFLICT",
              state: "PENDING",
              createdAt: new Date(),
            },
          ],
        }),
      },
      resolveReview: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("~/app/_components/timed-action-dialog", () => ({
  TimedActionDialog: ({
    onConfirm,
  }: {
    onConfirm: (ticket: string) => void;
  }) => (
    <div role="dialog">
      <button onClick={() => onConfirm("timed-ticket")}>Confirm review</button>
    </div>
  ),
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  mocks.loaded = true;
  mocks.error = null;
  mocks.mutate.mockClear();
});
afterEach(() => {
  cleanup();
  client.clear();
});
const page = () => (
  <QueryClientProvider client={client}>
    <StudentWithdrawals />
  </QueryClientProvider>
);
it("shows student withdrawal sources together while excluding schedule reviews", () => {
  render(page());
  expect(screen.getByText("Survey Student")).toBeTruthy();
  expect(screen.getByText("Manual Student")).toBeTruthy();
  expect(screen.queryByText("Schedule Only")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "studentHeading 2" }),
  ).toBeTruthy();
  expect(screen.getAllByText(/effectiveOnApproval/)).toHaveLength(2);
});
it("defers approval until the existing timed confirmation returns its ticket", () => {
  render(page());
  fireEvent.click(
    within(screen.getByText("Survey Student").closest("article")!).getByRole(
      "button",
      { name: "approve" },
    ),
  );
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
  expect(mocks.mutate).toHaveBeenCalledWith({
    id: "survey-review",
    approve: true,
    ticket: "timed-ticket",
  });
});
it("defers a decline to the same timed review while keeping both decisions compact", () => {
  mocks.mutate.mockClear();
  render(page());
  const card = within(screen.getByText("Survey Student").closest("article")!);
  const approve = card.getByRole("button", { name: "approve" });
  const decline = card.getByRole("button", { name: "deny" });
  expect(approve.className).toContain("control-compact");
  expect(decline.className).toContain("control-compact");
  fireEvent.click(decline);
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
    id: "survey-review",
    approve: false,
    ticket: "timed-ticket",
  });
});

it("reports parent page readiness from both authorized feeds without passing records or writing decisions", () => {
  const onViewReadState = vi.fn();
  mocks.loaded = false;
  const show = () => (
    <QueryClientProvider client={client}>
      <StudentWithdrawals onViewReadState={onViewReadState} />
    </QueryClientProvider>
  );
  const view = render(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: false,
    denied: false,
  });
  mocks.loaded = true;
  view.rerender(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: true,
    denied: false,
  });
  mocks.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: false,
    denied: true,
  });
  expect(screen.queryByText("Survey Student")).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});
