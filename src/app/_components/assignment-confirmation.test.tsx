/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode, useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
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
      prepare: {
        useMutation: () => ({ mutateAsync: mocks.prepare, reset: vi.fn() }),
      },
      cancel: { useMutation: () => ({ mutate: mocks.cancel }) },
    },
  },
}));
const result = (id = "ticket") => ({
  ticket: {
    id,
    serverNow: new Date(),
    readyAt: new Date(Date.now() + 2000),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  },
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
  vi.restoreAllMocks();
});
const dialog = (
  tutorId = "a",
  extra: Partial<ComponentProps<typeof AssignmentConfirmation>> = {},
) => (
  <NextIntlClientProvider locale="en" messages={en}>
    <AssignmentConfirmation
      operation="admin.createPairing"
      payload={{ tutorId, subjectId: "math" }}
      onConfirm={mocks.confirm}
      onCancel={mocks.close}
      {...extra}
    />
  </NextIntlClientProvider>
);
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

it("shows the mismatch and enables explicit confirmation at exactly 2000ms", async () => {
  render(dialog());
  await flush();
  expect(
    screen.getByText("Ada has no approved qualification for Math."),
  ).toBeTruthy();
  await act(() => vi.advanceTimersByTime(1999));
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
  await act(() => vi.advanceTimersByTime(2000));
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
      .getByRole("button", { name: "Confirm in 2s" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("changing the tutor resets the entire acknowledgement and timer", async () => {
  const view = render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  view.rerender(dialog("b"));
  await flush();
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
  expect(
    screen
      .getByRole("button", { name: "Confirm in 2s" })
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
it("guards duplicates, freezes Escape and retries after the same write rejection", async () => {
  const view = render(dialog("a", { error: "Earlier rejection" }));
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Assigning…" }));
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  const modal = screen.getByRole("dialog");
  expect(modal.getAttribute("closedby")).toBe("none");
  expect(fireEvent.keyDown(modal, { key: "Escape" })).toBe(false);
  view.rerender(dialog("a", { busy: true, error: "Earlier rejection" }));
  view.rerender(dialog("a", { error: "Earlier rejection" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
});
it("offers explicit rechecking after a qualified write fails without an automatic retry loop", async () => {
  mocks.prepare.mockResolvedValue({ ticket: null, mismatches: [] });
  const view = render(dialog());
  await flush();
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  view.rerender(dialog("a", { busy: true }));
  view.rerender(dialog("a", { error: "Write rejected" }));
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  await flush();
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
});
it("allows another explicit attempt after identical immediate promise rejections", async () => {
  const confirm = vi.fn(() => Promise.reject(new Error("Same rejection")));
  render(dialog("a", { error: "Same rejection", onConfirm: confirm }));
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  const button = screen.getByRole("button", {
    name: "Confirm unqualified assignment",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  await flush();
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(2);
  await flush();
});
it("uses live expiry after a suspended background timer and announces renewal", async () => {
  render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  const confirm = screen.getByRole("button", {
    name: "Confirm unqualified assignment",
  });
  vi.spyOn(performance, "now").mockReturnValue(5 * 60_000);
  fireEvent.click(confirm);
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent(document, new Event("visibilitychange"));
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toBe(
    en.assignmentQualification.confirmationExpired,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  await flush();
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  expect(mocks.cancel).toHaveBeenCalledWith({ ticket: "ticket" });
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
it("preserves submitted evidence for a pending write or dialog handoff", async () => {
  const view = render(dialog());
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm unqualified assignment" }),
  );
  view.unmount();
  expect(mocks.cancel).not.toHaveBeenCalled();
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
  await act(() => vi.advanceTimersByTime(2000));
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

it("blocks repeated Escape in both dialogs until a pending assignment's rejected promise settles", async () => {
  let rejectWrite!: (failure: Error) => void;
  mocks.confirm.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectWrite = reject;
      }),
  );
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
  // Busy props can settle before the returned write does. Keep both dialogs
  // protected until that actual promise rejects, then permit deliberate cancel.
  expect(review.getAttribute("closedby")).toBe("none");
  expect(parent.getAttribute("closedby")).toBe("none");
  await act(async () => rejectWrite(new Error("Assignment failed")));
  expect(review.getAttribute("closedby")).toBe("closerequest");
  expect(parent.getAttribute("closedby")).toBe("closerequest");
  fireEvent(review, new Event("cancel", { cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(mocks.close).not.toHaveBeenCalled();
});

it.each([false, true])(
  "does not retry a rejected assignment when a real advisory refetch clears its warning (manual=%s)",
  async (manual) => {
    vi.useRealTimers();
    mocks.prepare.mockResolvedValue({ ticket: null, mismatches: [] });
    let rejectWrite!: (failure: Error) => void;
    mocks.confirm
      .mockReset()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          }),
      );
    let finishRead!: (data: { warning: string | null }) => void;
    const read = vi.fn(
      () =>
        new Promise<{ warning: string | null }>((resolve) => {
          finishRead = resolve;
        }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function AdvisoryEditor() {
      const [error, setError] = useState<string>();
      const advisory = useQuery({
        queryKey: ["assignment-advisory"],
        queryFn: read,
        initialData: { warning: manual ? "Above preferred workload" : null },
        staleTime: Infinity,
      });
      return (
        <Modal title="Pairing editor" onClose={mocks.close} footer={null}>
          <input aria-label="Pairing notes" defaultValue="Keep this draft" />
          <AssignmentConfirmation
            operation="admin.createPairing"
            payload={{ tutorId: "a", subjectId: "math" }}
            error={error}
            workloadReview={{
              pending: advisory.isFetching,
              warning: advisory.data.warning,
            }}
            onCancel={mocks.close}
            onConfirm={async () => {
              try {
                await mocks.confirm();
              } catch (failure) {
                setError("Assignment failed");
                throw failure;
              }
            }}
          />
        </Modal>
      );
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <AdvisoryEditor />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    if (manual) {
      fireEvent.click(
        await screen.findByRole("button", { name: en.tutorWorkload.continue }),
      );
    }
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    const parent = screen.getByRole("dialog", { name: "Pairing editor" });
    expect(parent.getAttribute("closedby")).toBe("none");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
        .disabled,
    ).toBe(true);
    await act(async () => rejectWrite(new Error("Assignment failed")));
    await screen.findByRole("alert");
    expect(parent.getAttribute("closedby")).toBe("closerequest");
    act(() => {
      void client.refetchQueries({ queryKey: ["assignment-advisory"] });
    });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await act(async () => finishRead({ warning: null }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Pairing notes" })
        .value,
    ).toBe("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.close).not.toHaveBeenCalled();
    client.clear();
  },
);

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
