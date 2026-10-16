// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import messages from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { StudentScheduleAction } from "./student-schedule-action";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  prepare: vi.fn(),
  pending: false,
  error: "",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { tutorRoster: { invalidate: vi.fn() } },
    }),
    studentWorkflow: {
      prepareAction: {
        useMutation: () => ({
          mutate: state.prepare,
          data: { id: "issued-server-ticket", readyAt: new Date(0) },
        }),
      },
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
// Keep the real timed dialog: transport fixtures cannot stand in for its Escape
// handling, failed draft lifetime or feature-specific action/ticket contract.

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
const element = (active = true, locale = "en", schedule = row) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : messages}
  >
    <StudentScheduleAction
      row={schedule}
      active={active}
      name="Sample Learner"
    />
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
  expect(screen.getByRole("dialog", { name: /Sample Learner/ })).toBeTruthy();
  expect(state.prepare).toHaveBeenCalledWith({
    action: "SCHEDULE",
    target: "pairing:tutee",
  });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Schedule conflict draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.mutate).not.toHaveBeenCalled();
  open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Schedule conflict draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
  expect(state.mutate).toHaveBeenCalledWith({
    pairingId: "pairing",
    tuteeId: "tutee",
    reason: "Schedule conflict draft",
    ticket: "issued-server-ticket",
  });
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(true);
  const dialog = screen.getByRole("dialog");
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
  }
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(state.mutate).toHaveBeenCalledOnce();
  state.pending = false;
  state.error = "Review failed";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe("Review failed");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Schedule conflict draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(state.mutate.mock.calls[1]).toEqual(state.mutate.mock.calls[0]);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows the verification deadline without offering inactive tutors a new request", () => {
  render(element(false));
  expect(screen.getByText(/^Verification due:/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each([
  { locale: "en", catalog: messages, weekday: "Sun" },
  { locale: "zh", catalog: zh, weekday: "周日" },
])(
  "localizes $locale schedule evidence and preserves the confirmation payload",
  ({ locale, catalog, weekday }) => {
    const schedule = {
      ...row,
      slots: [
        {
          id: "weekend-slot",
          label: "Weekend",
          dayOfWeek: 7,
          startMin: 900,
          endMin: 960,
          active: true,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    };
    render(element(true, locale, schedule));
    expect(
      screen.getByText(
        `${catalog.workflow.availability}: ${weekday} 15:00–16:00`,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: catalog.workflow.scheduleReject }),
    );
    expect(state.prepare).toHaveBeenCalledExactlyOnceWith({
      action: "SCHEDULE",
      target: "pairing:tutee",
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Schedule conflict draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: catalog.workflow.confirm }),
    );
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
      pairingId: "pairing",
      tuteeId: "tutee",
      reason: "Schedule conflict draft",
      ticket: "issued-server-ticket",
    });
    expect(schedule.slots[0]).toMatchObject({
      id: "weekend-slot",
      dayOfWeek: 7,
      startMin: 900,
      endMin: 960,
    });
  },
);
