// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ProfileDialog } from "./profile-dialog";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLElement>("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

it.each(["close control", "Escape cancellation"])(
  "returns focus to its table trigger after %s",
  (method) => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button className="table-action-link" onClick={() => setOpen(true)}>
            View account details
          </button>
          {open && (
            <ProfileDialog
              title="Account details"
              onClose={() => setOpen(false)}
            >
              <p>Recorded contact information</p>
            </ProfileDialog>
          )}
        </>
      );
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Example />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole("button", {
      name: "View account details",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
      name: "Account details",
    });
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    if (method === "close control") {
      fireEvent.click(close);
    } else {
      const cancellation = new Event("cancel", {
        bubbles: true,
        cancelable: true,
      });
      fireEvent(dialog, cancellation);
      expect(cancellation.defaultPrevented).toBe(true);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  },
);

it("leaves nested portalled dialog keyboard and cancel events to the nested dialog", () => {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Account details" onClose={onClose}>
        <button>Retry loading</button>
        {createPortal(
          <dialog open aria-label="Nested confirmation">
            <button>Nested action</button>
          </dialog>,
          document.body,
        )}
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  const close = screen.getByRole("button", { name: "Close" });
  const nestedAction = screen.getByRole("button", { name: "Nested action" });
  // A child owns its events even while focus is transiently on a parent boundary.
  // Without the portal guard the parent's Shift+Tab trap consumes this event.
  close.focus();
  expect(fireEvent.keyDown(nestedAction, { key: "Tab", shiftKey: true })).toBe(
    true,
  );
  expect(document.activeElement).toBe(close);
  const cancellation = new Event("cancel", { bubbles: true, cancelable: true });
  fireEvent(
    screen.getByRole("dialog", { name: "Nested confirmation" }),
    cancellation,
  );
  expect(cancellation.defaultPrevented).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

it("does not refocus a trigger removed with its enclosing view", () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>View details</button>
        {open && (
          <ProfileDialog title="Account details" onClose={() => setOpen(false)}>
            <p>Recorded contact information</p>
          </ProfileDialog>
        )}
      </>
    );
  }
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Example />
    </NextIntlClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "View details" });
  trigger.focus();
  fireEvent.click(trigger);
  const focus = vi.spyOn(trigger, "focus");
  view.unmount();
  expect(focus).not.toHaveBeenCalled();
});
afterEach(cleanup);

it("keeps Tab and Shift+Tab on the sole close control in an empty detail dialog", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Details" onClose={vi.fn()}>
        <p>No recorded subjects</p>
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  const close = screen.getByRole("button", { name: "Close" });
  close.focus();
  expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(close);
  expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(close);
});

it("wraps first/last enabled controls without interfering with intermediate typing", () => {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Details" onClose={onClose}>
        <button disabled>Unavailable</button>
        <button>Retry</button>
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  const close = screen.getByRole("button", { name: "Close" });
  const retry = screen.getByRole("button", { name: "Retry" });
  retry.focus();
  fireEvent.keyDown(retry, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(retry);
  expect(fireEvent.keyDown(retry, { key: "x" })).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
