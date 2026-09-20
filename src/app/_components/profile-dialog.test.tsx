// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
