/** @vitest-environment jsdom */
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import { TimedActionDialog } from "./timed-action-dialog";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  readyAt: new Date(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  cancelTicket: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    studentWorkflow: {
      prepareAction: {
        useMutation: () => ({
          mutateAsync: mocks.prepare,
          reset: vi.fn(),
        }),
      },
      cancelAction: { useMutation: () => ({ mutate: mocks.cancelTicket }) },
    },
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  mocks.readyAt = new Date(Date.now() + 2000);
  mocks.prepare.mockImplementation(async () => ({
    id: "ticket",
    readyAt: mocks.readyAt,
    serverNow: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  }));
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
const element = (
  mandatory = false,
  busy = false,
  extra: Partial<ComponentProps<typeof TimedActionDialog>> = {},
) => (
  <NextIntlClientProvider locale="en" messages={en}>
    <TimedActionDialog
      action="RECALL"
      target="request-1"
      title="Recall request"
      message="This request closes permanently and admins will be notified."
      mandatory={mandatory}
      busy={busy}
      onConfirm={mocks.confirm}
      onCancel={mocks.cancel}
      {...extra}
    />
  </NextIntlClientProvider>
);
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const show = (mandatory = false, busy = false) =>
  render(element(mandatory, busy));

it("shows consequences and prevents confirmation before the timer ends", async () => {
  show();
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    screen.getByRole("dialog").getAttribute("aria-describedby"),
  ).toBeTruthy();
  const waiting = screen.getByRole("button", {
    name: "Confirm in 2s",
  });
  expect(waiting.hasAttribute("disabled")).toBe(true);
  fireEvent.click(waiting);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1999));
  expect(
    screen
      .getByRole("button", { name: "Confirm in 1s" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(() => vi.advanceTimersByTime(1));
  fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
  expect(mocks.confirm).toHaveBeenCalledWith("ticket");
});
it("allows cancelling immediately and clears its interval when closed", () => {
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.cancel).toHaveBeenCalledOnce();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores wall-clock jumps and announces the exact ready state", async () => {
  show();
  await flush();
  expect(screen.getByRole("status").textContent).toBe("Confirm in 2s");
  vi.setSystemTime(new Date("2040-01-01"));
  await act(() => vi.advanceTimersByTime(1999));
  expect(screen.getByRole("status").textContent).toBe("Confirm in 1s");
  vi.setSystemTime(new Date("2020-01-01"));
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status").textContent).toBe("Yes, confirm");
  expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
});

it("checks expired eligibility at click time before background callbacks resume", async () => {
  show();
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  const confirm = screen.getByRole("button", { name: "Yes, confirm" });
  vi.spyOn(performance, "now").mockReturnValue(30 * 60_000);
  fireEvent.click(confirm);
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent(window, new Event("focus"));
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toBe(
    en.workflow.confirmationExpired,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await flush();
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});

it("rebinds target/action and cancels late preparation without exposing old proof", async () => {
  let resolveOld!: (ticket: Awaited<ReturnType<typeof mocks.prepare>>) => void;
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const view = show();
  await flush();
  view.rerender(element(false, false, { action: "DENY", target: "request-2" }));
  await flush();
  await act(async () =>
    resolveOld({
      id: "old",
      readyAt: new Date(0),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      serverNow: new Date(),
    }),
  );
  expect(mocks.cancelTicket).toHaveBeenCalledWith({ ticket: "old" });
  expect(
    screen
      .getByRole("button", { name: "Confirm in 2s" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(mocks.prepare).toHaveBeenLastCalledWith({
    action: "DENY",
    target: "request-2",
  });
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("guards duplicate admission, preserves handoff proof, and releases only on rejection", async () => {
  const view = render(element(false, false, { error: "Earlier failure" }));
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  const click = () =>
    fireEvent.click(screen.getByRole("button", { name: "Yes, confirm" }));
  click();
  fireEvent.click(screen.getByRole("button", { name: "Working…" }));
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  view.rerender(element(false, true, { error: "Earlier failure" }));
  view.rerender(element(false, false, { error: "Earlier failure" }));
  click();
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(mocks.cancelTicket).not.toHaveBeenCalled();
});

it("reopening cancels unused proof and restarts a full fresh delay", async () => {
  const view = show();
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  view.unmount();
  expect(mocks.cancelTicket).toHaveBeenCalledWith({ ticket: "ticket" });
  mocks.readyAt = new Date(Date.now() + 2000);
  show();
  await flush();
  expect(
    screen
      .getByRole("button", { name: "Confirm in 2s" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("retries identical fast promise rejections without a pending-prop render", async () => {
  const failure = new Error("Same rejection");
  const confirm = vi.fn(() => Promise.reject(failure));
  render(element(false, false, { error: failure.message, onConfirm: confirm }));
  await flush();
  await act(() => vi.advanceTimersByTime(2000));
  const button = screen.getByRole("button", { name: "Yes, confirm" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  await flush();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledTimes(2);
  await flush();
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("releases the native top layer before restoring the exact opener through Strict Mode", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  // Native showModal focuses a child. Model that side effect so a missing
  // close/restore during the development rehearsal cannot pass accidentally.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    },
  });
  const close = vi.spyOn(HTMLDialogElement.prototype, "close");
  const focus = vi.spyOn(opener, "focus").mockImplementation(() => {
    // An opener outside an open native modal is inert, so that focus attempt
    // cannot succeed. jsdom itself does not implement this browser behavior.
    if (!document.querySelector("dialog[open]"))
      HTMLElement.prototype.focus.call(opener);
  });
  const view = render(<StrictMode>{element()}</StrictMode>);
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(close).toHaveBeenCalledTimes(2);
  expect(focus).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(opener);
  focus.mockRestore();
  close.mockRestore();
  opener.remove();
});

it.each(["removed", "disabled"])(
  "restores the remaining parent when the timed review opener is %s",
  (state) => {
    const parent = document.createElement("dialog");
    parent.tabIndex = -1;
    const opener = document.createElement("button");
    parent.append(opener);
    document.body.append(parent);
    parent.showModal();
    opener.focus();
    const view = show();
    if (state === "removed") opener.remove();
    else opener.disabled = true;
    view.unmount();
    expect(document.activeElement).toBe(parent);
    parent.close();
    parent.remove();
  },
);
it("closes a submitted proposal dialog so its approval notice can be opened", async () => {
  show();
  await act(() =>
    window.dispatchEvent(
      new CustomEvent("approval-queued", { detail: "request-1" }),
    ),
  );
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("cannot dismiss mandatory policy confirmation with Escape", () => {
  show(true);
  const event = new Event("cancel", { cancelable: true });
  fireEvent(screen.getByRole("dialog"), event);
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});

it.each([false, true])(
  "blocks repeated Escape during a write and restores the idle dismissal rule (mandatory: %s)",
  (mandatory) => {
    const view = show(mandatory, true);
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole<HTMLButtonElement>("button", {
      name: mandatory ? "Sign out" : "Cancel",
    });
    expect(dialog.getAttribute("closedby")).toBe("none");
    expect(cancel.disabled).toBe(true);
    // jsdom cannot emulate a browser's non-cancellable repeated close request.
    // Assert key-default suppression as well as the native watcher contract;
    // the reserved browser matrix must verify the actual dialog stays open.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        fireEvent.keyDown(dialog, { key: "Escape", repeat: attempt > 0 }),
      ).toBe(false);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }
    expect(mocks.cancel).not.toHaveBeenCalled();

    view.rerender(element(mandatory));
    expect(cancel.disabled).toBe(false);
    expect(dialog.getAttribute("closedby")).toBe(
      mandatory ? "none" : "closerequest",
    );
    expect(fireEvent.keyDown(cancel, { key: "Escape" })).toBe(!mandatory);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(mocks.cancel).toHaveBeenCalledTimes(mandatory ? 0 : 1);
    if (mandatory) {
      fireEvent.click(cancel);
      expect(mocks.cancel).toHaveBeenCalledOnce();
    }
    expect(mocks.confirm).not.toHaveBeenCalled();
  },
);
