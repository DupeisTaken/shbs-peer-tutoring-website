// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { StudentWithdrawals } from "./student-withdrawals";
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
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
          data: [
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
          ],
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
afterEach(cleanup);
it("shows student withdrawal sources together while excluding schedule reviews", () => {
  render(<StudentWithdrawals />);
  expect(screen.getByText("Survey Student")).toBeTruthy();
  expect(screen.getByText("Manual Student")).toBeTruthy();
  expect(screen.queryByText("Schedule Only")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "studentHeading 2" }),
  ).toBeTruthy();
  expect(screen.getAllByText(/effectiveOnApproval/)).toHaveLength(2);
});
it("defers approval until the existing timed confirmation returns its ticket", () => {
  render(<StudentWithdrawals />);
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
