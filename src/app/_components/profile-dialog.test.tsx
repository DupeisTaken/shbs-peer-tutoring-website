// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ProfileDialog } from "./profile-dialog";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});
afterEach(cleanup);

// This branch has the smaller profile test baseline. Keep the reviewed shared
// commit's nested pending fixture and assertions without importing feature tests.
it("a nested owned write guards both dialogs against repeated Escape and releases them after settlement", () => {
  const parentClose = vi.fn();
  const childClose = vi.fn();
  const content = (pending: boolean) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Parent editor" onClose={parentClose}>
        <ProfileDialog
          title="Nested review"
          pending={pending}
          onClose={childClose}
        >
          <p>Confirm</p>
        </ProfileDialog>
      </ProfileDialog>
    </NextIntlClientProvider>
  );
  const view = render(content(true));
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(dialog.getAttribute("closedby")).toBe("none");
    for (let attempt = 0; attempt < 3; attempt++)
      expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  }
  expect(parentClose).not.toHaveBeenCalled();
  expect(childClose).not.toHaveBeenCalled();
  view.rerender(content(false));
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(dialog.getAttribute("closedby")).toBe("closerequest");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
        .disabled,
    ).toBe(false);
  }
});

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
      <ProfileDialog title="Details" onClose={onClose} size="wide">
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

it("blocks Escape, Close and tabbing out while a creation write is pending", () => {
  const onClose = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Add Tutor" onClose={onClose} pending>
        <fieldset disabled>
          <input aria-label="Name" />
          <button>Save</button>
        </fieldset>
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true })),
  ).toBe(false);
  expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Add Tutor" onClose={onClose}>
        <button>Save</button>
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});
