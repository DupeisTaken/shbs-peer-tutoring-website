/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import type { ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AssignmentConfirmation } from "./assignment-confirmation";
import { QualifiedTutorSelect } from "./qualified-tutor-select";

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
  );
  const view = render(select("math"));
  expect(
    screen.getByRole("group", { name: "Qualified for this subject" })
      .textContent,
  ).toBe("Ben");
  expect(
    screen.getByRole("group", { name: "Not qualified — confirmation required" })
      .textContent,
  ).toBe("Ada");
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
      </NextIntlClientProvider>,
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
