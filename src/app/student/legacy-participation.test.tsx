// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LegacyParticipation } from "./legacy-participation";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { legacyParticipation: { invalidate: vi.fn() } },
    }),
    studentWorkflow: {
      legacyParticipation: { useQuery: mocks.query },
      applyLegacyWithdrawal: { useMutation: () => ({ mutate: mocks.mutate }) },
    },
  },
}));
vi.mock("~/app/_components/timed-action-dialog", () => ({
  TimedActionDialog: ({
    children,
    onConfirm,
    canConfirm,
  }: {
    children: React.ReactNode;
    onConfirm: (ticket: string) => void;
    canConfirm: boolean;
  }) => (
    <div role="dialog">
      {children}
      <button disabled={!canConfirm} onClick={() => onConfirm("timed-ticket")}>
        Confirm timed action
      </button>
    </div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({
    data: [
      { id: "owned", englishName: "Student", status: "ACTIVE", reviews: [] },
    ],
  });
});
afterEach(cleanup);
it("requires a reason and passes the owned profile to timed withdrawal", () => {
  render(<LegacyParticipation />);
  fireEvent.click(screen.getByRole("button", { name: "applyAbort" }));
  const confirm = screen.getByRole("button", { name: "Confirm timed action" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "reason" }), {
    target: { value: "My schedule changed" },
  });
  fireEvent.click(confirm);
  expect(mocks.mutate).toHaveBeenCalledWith({
    tuteeId: "owned",
    reason: "My schedule changed",
    ticket: "timed-ticket",
  });
});
it("shows a pending request without another withdrawal button", () => {
  mocks.query.mockReturnValue({
    data: [
      {
        id: "owned",
        englishName: "Student",
        status: "ACTIVE",
        reviews: [{ id: "review", state: "PENDING" }],
      },
    ],
  });
  render(<LegacyParticipation />);
  expect(screen.getByRole("status").textContent).toBe("abortPending");
  expect(screen.queryByRole("button")).toBeNull();
});
