/** @vitest-environment jsdom */
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PolicyAgreement } from "./policy-agreement";

const messages = {
  agreement: "I agree to the <policy>{appTitle} Policy</policy>.",
  public: {
    policy: {
      mustRead: "Open and read the policy first.",
      scrollPrompt: "Scroll to the end to continue.",
      readPrompt: "You have reached the end.",
      close: "Close",
      done: "Done",
    },
  },
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(body: string | null = "Read the policy.") {
  function Agreement() {
    const [checked, setChecked] = useState(false);
    return (
      <PolicyAgreement
        messageKey="agreement"
        appTitle="Peer Tutoring"
        policy={body === null ? null : { title: "Program policy", body }}
        checked={checked}
        onChange={setChecked}
      />
    );
  }
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Agreement />
    </NextIntlClientProvider>,
  );
}

it("keeps agreement disabled after a short policy is closed without pressing Done", () => {
  show();
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox");
  expect(checkbox.disabled).toBe(true);
  const opener = screen.getByRole("button", { name: "Peer Tutoring Policy" });
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close" }),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Done" }).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("requires the end of a long policy before Done enables agreement", () => {
  // jsdom cannot lay out scrollports; give this policy a real overflow boundary
  // and separately verify the read gate before, near, and at its bottom.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  show("# Program policy\n\nA longer policy must be read before agreeing.");
  fireEvent.click(screen.getByRole("button", { name: "Peer Tutoring Policy" }));
  const region = screen.getByRole("region", { name: "Program policy" });
  expect(region.tabIndex).toBe(0);
  const done = screen.getByRole<HTMLButtonElement>("button", { name: "Done" });
  expect(done.disabled).toBe(true);
  fireEvent.scroll(region, { target: { scrollTop: 600 } });
  expect(done.disabled).toBe(true);
  fireEvent.scroll(region, { target: { scrollTop: 900 } });
  expect(done.disabled).toBe(false);
  expect(screen.getByText("You have reached the end.")).toBeTruthy();
  fireEvent.click(done);
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox");
  expect(checkbox.disabled).toBe(false);
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
});

it("allows Escape to close a policy without granting read acceptance", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Peer Tutoring Policy" }));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
});

it("allows agreement immediately when no policy is configured", () => {
  show(null);
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox");
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  expect(screen.queryByText("Open and read the policy first.")).toBeNull();
});
