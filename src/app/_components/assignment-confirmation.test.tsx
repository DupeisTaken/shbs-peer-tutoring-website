/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import { AssignmentConfirmation } from "./assignment-confirmation";
import { QualifiedTutorSelect } from "./qualified-tutor-select";
import { Modal } from "./ui/modal";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  close: vi.fn(),
  grants: [{ tutorId: "b", subjectId: "math" }],
  grantsLoading: false,
  grantsError: null as Error | null,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    admin: {
      assignmentWorkloads: {
        useQuery: () => ({
          data: { termId: "term", tutors: [] },
          refetch: vi.fn(),
        }),
      },
      subjectEligibility: {
        useQuery: () => ({
          data: mocks.grants,
          isLoading: mocks.grantsLoading,
          error: mocks.grantsError,
        }),
      },
      subjects: {
        useQuery: () => ({
          data: [
            { id: "math", active: true, level: null },
            { id: "other", active: true, level: null },
            { id: "archived", active: false, level: null },
          ],
        }),
      },
    },
    assignment: {
      prepare: { useMutation: () => ({ mutateAsync: mocks.prepare }) },
      cancel: { useMutation: () => ({ mutate: mocks.cancel }) },
    },
  },
}));
const result = (id = "ticket") => ({
  ticket: { id, readyAt: new Date(Date.now() + 3000) },
  mismatches: [
    { tutorId: "a", tutorName: "Ada", subjectId: "math", subjectName: "Math" },
  ],
});
beforeEach(() => {
  mocks.grantsLoading = false;
  mocks.grantsError = null;
  vi.useFakeTimers();
  mocks.prepare.mockImplementation(async () => result());
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const dialog = (tutorId = "a") => (
  <NextIntlClientProvider locale="en" messages={en}>
    <AssignmentConfirmation
      operation="admin.createPairing"
      payload={{ tutorId, subjectId: "math" }}
      onConfirm={mocks.confirm}
      onCancel={mocks.close}
    />
  </NextIntlClientProvider>
);
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

it("shows the mismatch and enables explicit confirmation at exactly 3000ms", async () => {
  render(dialog());
  await flush();
  expect(
    screen.getByText("Ada has no approved qualification for Math."),
  ).toBeTruthy();
  await act(() => vi.advanceTimersByTime(2999));
  const waiting = screen.getByRole("button", { name: "Confirm in 1s" });
  expect(waiting.hasAttribute("disabled")).toBe(true);
  fireEvent.click(waiting);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("ticket");
});
it("cancels through Escape, discards the ticket, and restarts on reopening", async () => {
  const view = render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(3000));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(mocks.close).toHaveBeenCalledOnce();
  view.unmount();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
  render(dialog());
  await flush();
  expect(
    screen
      .getByRole("button", { name: "Confirm in 3s" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("changing the tutor resets the entire acknowledgement and timer", async () => {
  const view = render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(3000));
  view.rerender(dialog("b"));
  await flush();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
  expect(
    screen
      .getByRole("button", { name: "Confirm in 3s" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("ignores a stale preparation response after the selection changes", async () => {
  let resolveOld!: (value: ReturnType<typeof result>) => void;
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const view = render(dialog());
  await flush(); // The old request is already in flight when the selection changes.
  view.rerender(dialog("b"));
  await flush();
  await act(async () => {
    resolveOld(result("old-ticket"));
    await Promise.resolve();
  });
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "old-ticket" });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("qualified assignments continue without an override warning", async () => {
  mocks.prepare.mockResolvedValue({ ticket: null, mismatches: [] });
  render(dialog());
  await flush();
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith();
  expect(
    screen.queryByText("Assign a tutor without this qualification?"),
  ).toBeNull();
});
it("uses named native groups, preserves selectable unqualified tutors, and updates by course", () => {
  const select = (subjectId: string) => (
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        <QualifiedTutorSelect
          label="Tutor"
          subjectId={subjectId}
          tutors={[
            { id: "a", englishName: "Ada" },
            { id: "b", englishName: "Ben" },
          ]}
          value=""
          onChange={mocks.confirm}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(select("math"));
  expect(
    screen.getByRole("group", { name: "Qualified for this subject" })
      .textContent,
  ).toBe("Ben (?)");
  expect(
    screen.getByRole("group", { name: "Not qualified — confirmation required" })
      .textContent,
  ).toBe("Ada (?)");
  const control = screen.getByRole("combobox", { name: "Tutor" });
  control.focus();
  expect(document.activeElement).toBe(control);
  fireEvent.change(control, { target: { value: "a" } });
  expect(mocks.confirm).toHaveBeenCalledWith("a");
  view.rerender(select("other"));
  expect(
    screen.getByRole("group", { name: "Qualified for this subject" })
      .textContent,
  ).toBe("");
  expect(
    screen.getByText(/No tutors have an approved qualification/),
  ).toBeTruthy();
});

it("prepares only one acknowledgement under Strict Mode effect replay", async () => {
  render(<StrictMode>{dialog()}</StrictMode>);
  await flush();
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("discards unused evidence when cancelling after a failed submission", async () => {
  const view = render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(3000));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  view.unmount();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
});

it.each(["loading", "failed", "missing", "archived"])(
  "disables assignment while course eligibility is %s",
  (state) => {
    mocks.grantsLoading = state === "loading";
    mocks.grantsError = state === "failed" ? new Error("Unavailable") : null;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={en}>
          <QualifiedTutorSelect
            label="Tutor"
            subjectId={
              state === "missing"
                ? ""
                : state === "archived"
                  ? "archived"
                  : "math"
            }
            tutors={[{ id: "b", englishName: "Ben" }]}
            value=""
            onChange={mocks.confirm}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Tutor" })
        .disabled,
    ).toBe(true);
    if (state === "failed")
      expect(screen.getByRole("alert").textContent).toBe(
        en.assignmentQualification.loadError,
      );
    expect(mocks.confirm).not.toHaveBeenCalled();
  },
);

it("keeps Tab and Shift+Tab within the explicit dialog choices", async () => {
  render(dialog());
  await flush();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  await act(() => vi.advanceTimersByTime(3000));
  const confirm = screen.getByRole("button", {
    name: "Confirm unqualified assignment",
  });
  confirm.focus();
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("keeps qualification evidence and countdown when a workload review also applies", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AssignmentConfirmation
        operation="admin.createPairing"
        payload={{ tutorId: "a" }}
        onConfirm={mocks.confirm}
        onCancel={mocks.close}
        workloadReview={{
          pending: false,
          warning: "Two sessions exceed this tutor's preferred one.",
        }}
      />
    </NextIntlClientProvider>,
  );
  await flush();
  expect(
    screen.getByText("Two sessions exceed this tutor's preferred one."),
  ).toBeTruthy();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  await act(() => vi.advanceTimersByTime(3000));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("ticket");
});

/** Real nested shared dialogs verify the confirmation's ownership, not only its
 * visual markup. The parent draft stays mounted while review opens and closes. */
function NestedAssignment({
  busy = false,
  openerAfterClose = "enabled",
}: {
  busy?: boolean;
  openerAfterClose?: "enabled" | "disabled" | "removed";
}) {
  const [reviewing, setReviewing] = useState(false);
  const [closed, setClosed] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <Modal
        title="Pairing editor"
        onClose={mocks.close}
        footer={
          !(closed && openerAfterClose === "removed") && (
            <button
              disabled={closed && openerAfterClose === "disabled"}
              onClick={() => setReviewing(true)}
            >
              Assign tutor
            </button>
          )
        }
      >
        <input aria-label="Pairing notes" defaultValue="Keep this draft" />
        {reviewing && (
          <AssignmentConfirmation
            operation="admin.createPairing"
            payload={{ tutorId: "a", subjectId: "math" }}
            busy={busy}
            onConfirm={mocks.confirm}
            onCancel={() => {
              setClosed(true);
              setReviewing(false);
            }}
            workloadReview={{
              pending: false,
              warning: "Two sessions exceed this tutor's preferred one.",
            }}
          />
        )}
      </Modal>
    </NextIntlClientProvider>
  );
}

it.each(["enabled", "disabled", "removed"] as const)(
  "restores the %s opener or the remaining parent dialog after review",
  async (openerAfterClose) => {
    render(<NestedAssignment openerAfterClose={openerAfterClose} />);
    const opener = screen.getByRole("button", { name: "Assign tutor" });
    opener.focus();
    fireEvent.click(opener);
    await flush();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(
      openerAfterClose === "enabled"
        ? opener
        : screen.getByRole("dialog", { name: "Pairing editor" }),
    );
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Pairing notes" })
        .value,
    ).toBe("Keep this draft");
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ ticket: "ticket" });
    expect(mocks.close).not.toHaveBeenCalled();
  },
);

it("blocks repeated Escape in both review and parent while an assignment is pending", async () => {
  const view = render(<NestedAssignment />);
  const opener = screen.getByRole("button", { name: "Assign tutor" });
  opener.focus();
  fireEvent.click(opener);
  await flush();
  await act(() => vi.advanceTimersByTime(3000));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  view.rerender(<NestedAssignment busy />);
  const parent = screen.getByRole("dialog", { name: "Pairing editor" });
  const review = screen.getByRole("dialog", {
    name: en.assignmentQualification.warningTitle,
  });
  for (const dialog of [review, parent]) {
    expect(dialog.getAttribute("closedby")).toBe("none");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
  }
  expect(document.activeElement).toBe(review);
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("ticket");
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();

  view.rerender(<NestedAssignment />);
  expect(review.getAttribute("closedby")).toBe("closerequest");
  expect(parent.getAttribute("closedby")).toBe("closerequest");
  fireEvent(review, new Event("cancel", { cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("releases review after an accepted approval handoff even while the mutation is settling", async () => {
  const view = render(<NestedAssignment />);
  fireEvent.click(screen.getByRole("button", { name: "Assign tutor" }));
  await flush();
  view.rerender(<NestedAssignment busy />);
  fireEvent(window, new Event("approval-queued"));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen
      .getByRole("dialog", { name: "Pairing editor" })
      .getAttribute("closedby"),
  ).toBe("closerequest");
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ ticket: "ticket" });
  fireEvent(window, new Event("approval-queued"));
  expect(mocks.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.close).not.toHaveBeenCalled();
});
