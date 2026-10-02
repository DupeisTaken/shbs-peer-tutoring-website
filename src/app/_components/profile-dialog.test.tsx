// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";

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

// Nested writes must register with both dialogs independently of editor composition.
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

it("aggregates independently owned writes and releases sibling controls when each finishes", () => {
  function IndependentForm({
    pending,
    label,
  }: {
    pending: boolean;
    label: string;
  }) {
    const busy = useDialogPending(pending);
    return (
      <fieldset disabled={busy}>
        <input aria-label={label} />
      </fieldset>
    );
  }
  const onClose = vi.fn();
  const content = (academic: boolean, username: boolean) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileDialog title="Edit account" onClose={onClose} size="wide">
        <IndependentForm pending={academic} label="Academic correction" />
        <IndependentForm pending={username} label="Username" />
      </ProfileDialog>
    </NextIntlClientProvider>
  );
  const view = render(content(true, true));
  const close = screen.getByRole<HTMLButtonElement>("button", {
    name: "Close",
  });
  expect(close.disabled).toBe(true);
  expect(screen.getByLabelText("Username").matches(":disabled")).toBe(true);
  view.rerender(content(false, true));
  expect(close.disabled).toBe(true);
  expect(
    screen.getByLabelText("Academic correction").matches(":disabled"),
  ).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(content(false, false));
  expect(close.disabled).toBe(false);
  expect(screen.getByLabelText("Username").matches(":disabled")).toBe(false);
  expect(screen.getByRole("dialog").className).toContain("max-w-4xl");
  expect(close.parentElement?.className).toContain("sticky");
});

it("cancels only a real nested review and returns to its exact initiating control", () => {
  function Example() {
    const [nested, setNested] = useState(false);
    return (
      <ProfileDialog title="Parent editor" onClose={vi.fn()}>
        <input aria-label="Unsaved profile" defaultValue="Keep draft" />
        <button onClick={() => setNested(true)}>Review departure</button>
        {nested && (
          <ProfileDialog
            title="Departure review"
            onClose={() => setNested(false)}
          >
            <p>Review only</p>
          </ProfileDialog>
        )}
      </ProfileDialog>
    );
  }
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Example />
    </NextIntlClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Review departure" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent(
    screen.getByRole("dialog", { name: "Departure review" }),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Keep draft",
  );
  expect(document.activeElement).toBe(opener);
});

it("a nested owned write guards the child and parent without latching after settlement", () => {
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

it("keeps focus inside the parent when a completed review leaves its opener disabled", () => {
  function Example() {
    const [nested, setNested] = useState(false);
    const [completed, setCompleted] = useState(false);
    return (
      <ProfileDialog title="Parent editor" onClose={vi.fn()}>
        <button disabled={completed} onClick={() => setNested(true)}>
          Review draft
        </button>
        {nested && (
          <ProfileDialog title="Child review" onClose={() => setNested(false)}>
            <button
              onClick={() => {
                setCompleted(true);
                setNested(false);
              }}
            >
              Complete example
            </button>
          </ProfileDialog>
        )}
      </ProfileDialog>
    );
  }
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Example />
    </NextIntlClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Review draft" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Complete example" }));
  expect(document.activeElement).toBe(
    screen.getByRole("dialog", { name: "Parent editor" }),
  );
});
