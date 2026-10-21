// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import messages from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { StudentScheduleAction } from "./student-schedule-action";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  prepare: vi.fn(),
  cancelTicket: vi.fn(),
  pending: false,
  error: "",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: { tutorRoster: { invalidate: vi.fn() } },
    }),
    studentWorkflow: {
      cancelAction: { useMutation: () => ({ mutate: state.cancelTicket }) },
      prepareAction: {
        useMutation: () => ({
          mutateAsync: state.prepare,
          reset: vi.fn(),
        }),
      },
      rejectSchedule: {
        useMutation: () => ({
          mutate: state.mutate,
          mutateAsync: state.mutate,
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
beforeEach(() => {
  state.prepare.mockResolvedValue({
    id: "issued-server-ticket",
    readyAt: new Date(0),
    serverNow: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.pending = false;
  state.error = "";
});

it.each([
  ["en", "Edited"],
  ["zh", "已修改"],
])(
  "shows the unbracketed edited badge only for edited rows in %s",
  (locale, label) => {
    const view = render(element(true, locale));
    expect(screen.queryByText(label)).toBeNull();

    view.rerender(
      element(true, locale, {
        ...row,
        editedAt: new Date("2026-10-20T00:00:00Z"),
      }),
    );
    expect(screen.getByText(label).classList.contains("badge-amber")).toBe(true);
    expect(screen.queryByText(`[${label}]`)).toBeNull();

    view.rerender(element(true, locale));
    expect(screen.queryByText(label)).toBeNull();
  },
);

it("retains canceled/failed reasons and passes the unchanged server ticket and target", async () => {
  state.prepare.mockImplementation(async () => ({
    id: "issued-server-ticket",
    readyAt: new Date(0),
    serverNow: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  }));
  const view = render(element());
  const open = () =>
    fireEvent.click(
      screen.getByRole("button", { name: messages.workflow.scheduleReject }),
    );
  open();
  await act(async () => undefined);
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
  await act(async () => undefined);
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
  // The feature returns its mutation promise; model the retried rejection even
  // when no new pending/error-prop render is observed before cancellation.
  state.mutate.mockRejectedValueOnce(new Error("Review failed"));
  fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(state.mutate.mock.calls[1]).toEqual(state.mutate.mock.calls[0]);
  await act(async () => undefined);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows the verification deadline without offering inactive tutors a new request", () => {
  render(element(false));
  expect(screen.getByText(/^Verification due:/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["read-failure", "pending-review"] as const)(
  "retains an open reason but blocks the ready ticket after %s until eligibility returns",
  async (transition) => {
    state.prepare.mockResolvedValue({
      id: "ready-ticket",
      readyAt: new Date(0),
      serverNow: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const view = render(element());
    fireEvent.click(screen.getByRole("button", {
      name: messages.workflow.scheduleReject,
    }));
    await act(async () => undefined);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Retained schedule reason" },
    });
    const changed = transition === "pending-review"
      ? { ...row, pending: true }
      : row;
    view.rerender(element(transition !== "read-failure", "en", changed));
    const confirm = screen.getByRole<HTMLButtonElement>("button", {
      name: messages.workflow.confirm,
    });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Retained schedule reason",
    );
    view.rerender(element());
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
      pairingId: "pairing",
      tuteeId: "tutee",
      reason: "Retained schedule reason",
      ticket: "ready-ticket",
    });
  },
);

it.each([
  { locale: "en", catalog: messages, weekday: "Sun" },
  { locale: "zh", catalog: zh, weekday: "周日" },
])(
  "localizes $locale schedule evidence and preserves the confirmation payload",
  async ({ locale, catalog, weekday }) => {
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
    await act(async () => undefined);
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
