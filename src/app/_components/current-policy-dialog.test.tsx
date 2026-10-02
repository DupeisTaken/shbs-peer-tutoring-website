/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { CurrentPolicyDialog } from "./current-policy-dialog";
import { ProfileDialog } from "./profile-dialog";

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(cleanup);
const documents = [
  {
    locale: "en",
    title: "Current programme policy",
    body: "Saved policy contents",
    version: "2",
  },
];

it("retains the independent reader viewport and hides cached policy during refresh and failure", () => {
  const retry = vi.fn();
  const content = (loading: boolean, error: boolean) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <CurrentPolicyDialog
        documents={documents}
        loading={loading}
        error={error}
        onRetry={retry}
        onClose={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  const view = render(content(false, false));
  expect(screen.getByText("Saved policy contents")).toBeTruthy();
  const viewport = screen.getByRole("region");
  expect(viewport.className).toContain("overflow-y-auto");
  expect(viewport.tabIndex).toBe(0);
  expect(screen.getByRole("dialog").className).toContain("overflow-hidden");
  view.rerender(content(true, false));
  expect(screen.queryByText("Saved policy contents")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  view.rerender(content(false, true));
  expect(screen.queryByText("Saved policy contents")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(within(viewport).getByRole("button"));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("keeps a parent editor open when a nested reader is cancelled", () => {
  const parentClose = vi.fn();
  function Example() {
    const [reader, setReader] = useState(false);
    return (
      <ProfileDialog title="Participant" onClose={parentClose}>
        <button onClick={() => setReader(true)}>Read policy</button>
        {reader && (
          <CurrentPolicyDialog
            documents={documents}
            loading={false}
            error={false}
            onRetry={vi.fn()}
            onClose={() => setReader(false)}
          />
        )}
      </ProfileDialog>
    );
  }
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Example />
    </NextIntlClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Read policy" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent(
    screen.getByRole("dialog", { name: "Current programme policy" }),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(parentClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);
});
