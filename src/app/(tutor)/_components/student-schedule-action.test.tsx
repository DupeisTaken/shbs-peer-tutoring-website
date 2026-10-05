// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import messages from "../../../../messages/en.json";
import { StudentScheduleAction } from "./student-schedule-action";
import type { TimedActionDialog } from "~/app/_components/timed-action-dialog";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  pending: false,
  error: "",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { tutorRoster: { invalidate: vi.fn() } },
    }),
    studentWorkflow: {
      rejectSchedule: {
        useMutation: () => ({
          mutate: state.mutate,
          isPending: state.pending,
          error: state.error ? new Error(state.error) : null,
        }),
      },
    },
  },
}));
// The shared dialog has its own real countdown tests. This verifies that the
// feature preserves its action/target contract and forwards the issued ticket.
vi.mock("~/app/_components/timed-action-dialog", () => ({
  TimedActionDialog: (props: ComponentProps<typeof TimedActionDialog>) => (
    <div role="dialog" aria-label={props.title}>
      <p>
        {props.action}:{props.target}
      </p>
      {props.children}
      {props.error && <p role="alert">{props.error}</p>}
      <button disabled={props.busy} onClick={props.onCancel}>
        Cancel review
      </button>
      <button
        disabled={(props.busy ?? false) || !props.canConfirm}
        onClick={() => props.onConfirm("issued-server-ticket")}
      >
        Confirm review
      </button>
    </div>
  ),
}));

const row: ComponentProps<typeof StudentScheduleAction>["row"] = {
  pairingId: "pairing",
  tuteeId: "tutee",
  managed: true,
  verified: false,
  pending: false,
  editedAt: null,
  verificationDueAt: new Date("2026-10-09T00:00:00Z"),
  slots: [],
};
const element = (active = true) => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    <StudentScheduleAction row={row} active={active} name="Sample Learner" />
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.pending = false;
  state.error = "";
});

it("retains canceled/failed reasons and passes the unchanged server ticket and target", () => {
  const view = render(element());
  const open = () =>
    fireEvent.click(
      screen.getByRole("button", { name: messages.workflow.scheduleReject }),
    );
  open();
  expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain(
    "Sample Learner",
  );
  expect(screen.getByText("SCHEDULE:pairing:tutee")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Schedule conflict draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
  expect(state.mutate).not.toHaveBeenCalled();
  open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Schedule conflict draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
  expect(state.mutate).toHaveBeenCalledWith({
    pairingId: "pairing",
    tuteeId: "tutee",
    reason: "Schedule conflict draft",
    ticket: "issued-server-ticket",
  });
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(true);
  state.pending = false;
  state.error = "Review failed";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe("Review failed");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Schedule conflict draft",
  );
});
it("shows the verification deadline without offering inactive tutors a new request", () => {
  render(element(false));
  expect(screen.getByText(/^Verification due:/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
