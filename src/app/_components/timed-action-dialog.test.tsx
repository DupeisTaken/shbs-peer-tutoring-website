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
import en from "../../../messages/en.json";
import { TimedActionDialog } from "./timed-action-dialog";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  readyAt: new Date(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    studentWorkflow: {
      prepareAction: {
        useMutation: () => ({
          mutate: mocks.prepare,
          data: { id: "ticket", readyAt: mocks.readyAt },
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  mocks.readyAt = new Date(Date.now() + 5000);
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
const show = (mandatory = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TimedActionDialog
        action="RECALL"
        target="request-1"
        title="Recall request"
        message="This request closes permanently and admins will be notified."
        mandatory={mandatory}
        onConfirm={mocks.confirm}
        onCancel={mocks.cancel}
      />
    </NextIntlClientProvider>,
  );

it("shows consequences and prevents confirmation before the timer ends", async () => {
  show();
  expect(
    screen.getByRole("dialog").getAttribute("aria-describedby"),
  ).toBeTruthy();
  const waiting = screen.getByRole("button", {
    name: "Confirm in 5s",
  });
  expect(waiting.hasAttribute("disabled")).toBe(true);
  fireEvent.click(waiting);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(4000));
  expect(
    screen
      .getByRole("button", { name: "Confirm in 1s" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(() => vi.advanceTimersByTime(1000));
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
