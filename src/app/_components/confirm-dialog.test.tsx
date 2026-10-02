/** @vitest-environment jsdom */
import { createRef, useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useDialog } from "./confirm-dialog";

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
afterEach(cleanup);

function Harness({ handle }: { handle: Ref<ReturnType<typeof useDialog>> }) {
  const api = useDialog();
  // The imperative test handle models feature code issuing a new request while
  // the current native modal prevents interaction with the background page.
  useImperativeHandle(handle, () => api, [api]);
  return api.dialog;
}

function setup() {
  const handle = createRef<ReturnType<typeof useDialog>>();
  const view = render(<Harness handle={handle} />);
  return { handle, view };
}

const confirmation = {
  title: "Delete meeting?",
  message: "Attendance records will be removed.",
  confirmLabel: "Delete meeting",
  cancelLabel: "Keep meeting",
  danger: true,
};
const reason = {
  title: "Reject request",
  confirmLabel: "Reject request",
  cancelLabel: "Cancel",
  reasonLabel: "Reason for rejection",
  required: true,
};

it("focuses the safe cancellation and restores the opener when confirmation is declined", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  const { handle } = setup();
  opener.focus();
  let pending!: Promise<boolean>;
  act(() => {
    pending = handle.current!.confirm(confirmation);
  });
  const cancel = screen.getByRole("button", { name: "Keep meeting" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  await expect(pending).resolves.toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("resolves an explicit destructive confirmation exactly once", async () => {
  const { handle } = setup();
  let pending!: Promise<boolean>;
  act(() => {
    pending = handle.current!.confirm(confirmation);
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete meeting" }));
  await expect(pending).resolves.toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("focuses the reason, rejects whitespace and returns trimmed required text", async () => {
  const { handle } = setup();
  let pending!: Promise<string | null>;
  act(() => {
    pending = handle.current!.promptText(reason);
  });
  const input = screen.getByRole("textbox", { name: "Reason for rejection" });
  const confirm = screen.getByRole<HTMLButtonElement>("button", {
    name: "Reject request",
  });
  expect(document.activeElement).toBe(input);
  expect(confirm.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "  \n  " } });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(input, {
    target: { value: "  Please select a different period.  " },
  });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await expect(pending).resolves.toBe("Please select a different period.");
});

it("settles a prompt as cancelled when native Escape dispatches cancel", async () => {
  const { handle } = setup();
  let pending!: Promise<string | null>;
  act(() => {
    pending = handle.current!.promptText(reason);
  });
  const cancellation = new Event("cancel", { cancelable: true });
  fireEvent(screen.getByRole("dialog"), cancellation);
  expect(cancellation.defaultPrevented).toBe(true);
  await expect(pending).resolves.toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("allows an optional empty reason and keeps it distinct from cancellation", async () => {
  const { handle } = setup();
  let pending!: Promise<string | null>;
  act(() => {
    pending = handle.current!.promptText({ ...reason, required: false });
  });
  fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
  await expect(pending).resolves.toBe("");
});

it("settles superseded identical prompts and resets their draft and autofocus", async () => {
  const { handle } = setup();
  let first!: Promise<string | null>;
  let second!: Promise<string | null>;
  act(() => {
    first = handle.current!.promptText({
      ...reason,
      defaultValue: "First request",
    });
  });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Unrelated unsaved text" },
  });
  screen.getByRole("button", { name: "Cancel" }).focus();
  act(() => {
    second = handle.current!.promptText({
      ...reason,
      defaultValue: "Second request",
    });
  });
  await expect(first).resolves.toBeNull();
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Reason for rejection",
  });
  expect(input.value).toBe("Second request");
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
  await expect(second).resolves.toBe("Second request");
});

it("moves focus to a new reason field when a prompt supersedes a confirmation", async () => {
  const { handle } = setup();
  let first!: Promise<boolean>;
  let second!: Promise<string | null>;
  act(() => {
    first = handle.current!.confirm(confirmation);
  });
  act(() => {
    second = handle.current!.promptText(reason);
  });
  await expect(first).resolves.toBe(false);
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Reason for rejection" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await expect(second).resolves.toBeNull();
});

it.each(["confirm", "prompt"] as const)(
  "settles a pending %s when its feature unmounts",
  async (kind) => {
    const { handle, view } = setup();
    let pending!: Promise<boolean | string | null>;
    act(() => {
      pending =
        kind === "confirm"
          ? handle.current!.confirm(confirmation)
          : handle.current!.promptText(reason);
    });
    view.unmount();
    await expect(pending).resolves.toBe(kind === "confirm" ? false : null);
  },
);
