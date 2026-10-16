/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  CreationRiskDialog,
  type CreationRiskKind,
} from "./creation-risk-dialog";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(cleanup);

it("keeps rejected admission retryable and disabled admission cancellable", () => {
  const cancel = vi.fn();
  const proceed = vi
    .fn<() => boolean>()
    .mockReturnValueOnce(false)
    .mockReturnValue(true);
  const gate = (disabled = false) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <CreationRiskDialog
        kind="pairing"
        onCancel={cancel}
        onContinue={proceed}
        continueDisabled={disabled}
      />
    </NextIntlClientProvider>
  );
  const view = render(gate());
  fireEvent.click(screen.getByRole("checkbox"));
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: en.admin.creationRisk.continue,
  });
  fireEvent.click(button);
  expect(proceed).toHaveBeenCalledOnce();
  view.rerender(gate(true));
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(proceed).toHaveBeenCalledOnce();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(cancel).toHaveBeenCalledOnce();
  view.unmount();
  render(gate());
  fireEvent.click(screen.getByRole("checkbox"));
  proceed.mockReturnValueOnce(false);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.creationRisk.continue }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.creationRisk.continue }),
  );
  expect(proceed).toHaveBeenCalledTimes(3);
});

it.each(["en", "zh"] as const)(
  "requires explicit acknowledgment for all kinds in %s and excludes duplicate continuation",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    const copy = messages.admin.creationRisk;
    for (const kind of ["pairing", "tutee", "tutor"] as CreationRiskKind[]) {
      const proceed = vi.fn();
      const view = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CreationRiskDialog
            kind={kind}
            onCancel={vi.fn()}
            onContinue={proceed}
          />
        </NextIntlClientProvider>,
      );
      const dialog = screen.getByRole("dialog", { name: copy[kind].title });
      expect(dialog.textContent).toContain(copy[kind].normal);
      expect(dialog.textContent).toContain(copy[kind].risk);
      expect(dialog.textContent).toContain(copy.opensOnly);
      const checkbox = screen.getByRole<HTMLInputElement>("checkbox", {
        name: copy.acknowledgement,
      });
      const button = screen.getByRole<HTMLButtonElement>("button", {
        name: copy.continue,
      });
      expect(checkbox.checked).toBe(false);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(proceed).not.toHaveBeenCalled();
      fireEvent.click(checkbox);
      expect(button.disabled).toBe(false);
      fireEvent.click(checkbox);
      expect(button.disabled).toBe(true);
      fireEvent.click(checkbox);
      fireEvent.click(button);
      fireEvent.click(button);
      expect(proceed).toHaveBeenCalledOnce();
      view.unmount();
    }
  },
);

it("focuses Cancel, cancels through native Escape, and resets on the next mount", () => {
  const cancel = vi.fn();
  const proceed = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const gate = (
    <NextIntlClientProvider locale="en" messages={en}>
      <CreationRiskDialog
        kind="pairing"
        onCancel={cancel}
        onContinue={proceed}
      />
    </NextIntlClientProvider>
  );
  const view = render(gate);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: en.admin.creationRisk.cancel }),
  );
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(proceed).not.toHaveBeenCalled();
  view.unmount();
  expect(document.activeElement).toBe(opener);
  const next = render(gate);
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.creationRisk.cancel }),
  );
  expect(cancel).toHaveBeenCalledTimes(2);
  next.unmount();
  opener.remove();
});
