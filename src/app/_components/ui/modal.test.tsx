/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./modal";

beforeEach(() => {
  // jsdom has no browser top layer: exercise our handlers while the runtime suite
  // verifies native inertness and the actual Escape-to-cancel browser behavior.
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
const outsideRoots: HTMLElement[] = [];
afterEach(() => {
  cleanup();
  outsideRoots.splice(0).forEach((root) => root.remove());
  vi.restoreAllMocks();
});

function focusTargets() {
  const root = document.createElement("section");
  const opener = document.createElement("button");
  opener.textContent = "Review signup";
  const retry = document.createElement("button");
  retry.textContent = "Retry account details";
  root.append(opener, retry);
  document.body.append(root);
  outsideRoots.push(root);
  opener.focus();
  return { root, opener, retry };
}

it.each(["disabled", "removed"] as const)(
  "returns top-level dismissal focus to the owner recovery when its opener is %s",
  (unavailable) => {
    const { opener, retry } = focusTargets();
    const fallback = vi.fn(() => retry);
    const view = render(
      <Modal
        title="Review signup"
        onClose={vi.fn()}
        returnFocusFallback={fallback}
        footer={<button data-dialog-autofocus>Cancel</button>}
      />,
    );
    if (unavailable === "disabled") opener.disabled = true;
    else opener.remove();
    view.unmount();
    expect(fallback).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(retry);
  },
);

it("prefers the exact usable opener over the owner recovery", () => {
  const { opener, retry } = focusTargets();
  const fallback = vi.fn(() => retry);
  const view = render(
    <Modal
      title="Review signup"
      onClose={vi.fn()}
      returnFocusFallback={fallback}
      footer={null}
    />,
  );
  view.unmount();
  expect(document.activeElement).toBe(opener);
  expect(fallback).not.toHaveBeenCalled();
});

it("prefers a remaining open parent over the owner recovery", () => {
  const { root, opener, retry } = focusTargets();
  const parent = document.createElement("dialog");
  parent.open = true;
  parent.tabIndex = -1;
  root.prepend(parent);
  parent.append(opener);
  opener.focus();
  const fallback = vi.fn(() => retry);
  const view = render(
    <Modal
      title="Child review"
      onClose={vi.fn()}
      returnFocusFallback={fallback}
      footer={null}
    />,
  );
  opener.disabled = true;
  view.unmount();
  expect(document.activeElement).toBe(parent);
  expect(fallback).not.toHaveBeenCalled();
});

it.each(["closed", "removed"] as const)(
  "uses the owner recovery when the captured parent is %s",
  (unavailable) => {
    const { root, opener, retry } = focusTargets();
    const parent = document.createElement("dialog");
    parent.open = true;
    parent.tabIndex = -1;
    root.prepend(parent);
    parent.append(opener);
    opener.focus();
    const view = render(
      <Modal
        title="Child review"
        onClose={vi.fn()}
        returnFocusFallback={() => retry}
        footer={null}
      />,
    );
    opener.disabled = true;
    if (unavailable === "closed") parent.close();
    else parent.remove();
    view.unmount();
    expect(document.activeElement).toBe(retry);
  },
);

it("resolves the latest owner recovery without reopening or refocusing the dialog", () => {
  const { root, opener, retry } = focusTargets();
  const replacement = document.createElement("button");
  replacement.textContent = "Retry current account";
  root.append(replacement);
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  const modal = (fallback: () => HTMLElement | null) => (
    <Modal
      title="Review signup"
      onClose={vi.fn()}
      returnFocusFallback={fallback}
      footer={<button data-dialog-autofocus>Cancel</button>}
    />
  );
  const view = render(modal(() => retry));
  const dialog = screen.getByRole("dialog");
  const cancel = screen.getByRole("button", { name: "Cancel" });
  view.rerender(modal(() => replacement));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(document.activeElement).toBe(cancel);
  expect(show).toHaveBeenCalledOnce();
  opener.disabled = true;
  view.unmount();
  expect(document.activeElement).toBe(replacement);
  show.mockRestore();
});

it.each([
  "missing",
  "disabled",
  "disabled fieldset",
  "removed",
  "hidden",
  "inert",
  "display none",
  "hidden ancestor",
  "closed disclosure",
  "closed dialog",
  "not focusable",
] as const)("ignores an unavailable %s owner recovery", (unavailable) => {
  const { root, opener, retry } = focusTargets();
  if (unavailable === "disabled") retry.disabled = true;
  if (unavailable === "removed") retry.remove();
  if (unavailable === "hidden") retry.hidden = true;
  if (unavailable === "inert") root.setAttribute("inert", "");
  if (unavailable === "display none") retry.style.display = "none";
  if (unavailable === "hidden ancestor") root.style.visibility = "hidden";
  if (unavailable === "disabled fieldset") {
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    root.append(fieldset);
    fieldset.append(retry);
  }
  if (unavailable === "closed disclosure") {
    const details = document.createElement("details");
    root.append(details);
    details.append(document.createElement("summary"), retry);
  }
  if (unavailable === "closed dialog") {
    const dialog = document.createElement("dialog");
    root.append(dialog);
    dialog.append(retry);
  }
  const target = unavailable === "not focusable" ? root : retry;
  const focus = vi.spyOn(target, "focus");
  const view = render(
    <Modal
      title="Review signup"
      onClose={vi.fn()}
      returnFocusFallback={() => (unavailable === "missing" ? null : target)}
      footer={null}
    />,
  );
  opener.disabled = true;
  view.unmount();
  expect(focus).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(target);
});

it("does not steal owner recovery focus from another connected control", () => {
  const { root, opener, retry } = focusTargets();
  const elsewhere = document.createElement("button");
  root.append(elsewhere);
  const fallback = vi.fn(() => retry);
  const view = render(
    <Modal
      title="Review signup"
      onClose={vi.fn()}
      returnFocusFallback={fallback}
      footer={null}
    />,
  );
  opener.disabled = true;
  elsewhere.focus();
  view.unmount();
  expect(document.activeElement).toBe(elsewhere);
  expect(fallback).not.toHaveBeenCalled();
});

it("suppresses repeated Escape defaults while busy and restores native dismissal afterward", () => {
  const close = vi.fn();
  const view = render(
    <Modal title="Saving changes" busy onClose={close} footer={null} />,
  );
  const dialog = screen.getByRole("dialog", { name: "Saving changes" });
  expect(dialog.getAttribute("closedby")).toBe("none");
  for (let attempt = 0; attempt < 3; attempt++)
    expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Modal title="Saving changes" onClose={close} footer={null} />);
  expect(dialog.getAttribute("closedby")).toBe("closerequest");
  expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});

it("names the dialog, initially focuses the safe action, and restores the opener", () => {
  const opener = document.createElement("button");
  opener.textContent = "Delete meeting";
  document.body.append(opener);
  opener.focus();
  const view = render(
    <Modal
      title="Delete meeting?"
      description="The meeting and its attendance records will be removed."
      onClose={vi.fn()}
      footer={
        <>
          <button data-dialog-autofocus>Cancel</button>
          <button>Delete meeting</button>
        </>
      }
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Delete meeting?" });
  const description = document.getElementById(
    dialog.getAttribute("aria-describedby")!,
  );
  expect(description?.textContent).toContain(
    "attendance records will be removed",
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
  view.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("wraps both boundaries while skipping disabled, hidden, inert and negative-tabindex controls", () => {
  render(
    <Modal
      title="Edit meeting"
      onClose={vi.fn()}
      footer={<button>Save meeting</button>}
    >
      <button disabled>Unavailable</button>
      <fieldset disabled>
        <button>Disabled by fieldset</button>
      </fieldset>
      <div hidden>
        <button>Hidden action</button>
      </div>
      <div inert>
        <button>Inert action</button>
      </div>
      <button style={{ display: "none" }}>Invisible action</button>
      <div style={{ display: "none" }}>
        <div>
          <button>Hidden ancestor action</button>
        </div>
      </div>
      <div style={{ visibility: "hidden" }}>
        <button>Invisible ancestor action</button>
      </div>
      <input type="hidden" tabIndex={0} />
      <button tabIndex={-1}>Programmatic only</button>
      <input aria-label="Meeting name" />
      <button>Preview</button>
    </Modal>,
  );
  const first = screen.getByRole("textbox", { name: "Meeting name" });
  const last = screen.getByRole("button", { name: "Save meeting" });
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(first);
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(last);
  first.focus();
  expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
  expect(fireEvent.keyDown(first, { key: "a" })).toBe(true);
});

it("skips controls in a closed disclosure while preserving its reachable summary", () => {
  render(
    <Modal
      title="Review request"
      onClose={vi.fn()}
      footer={<button>Close</button>}
    >
      <details>
        <summary>More context</summary>
        <button>Hidden until expanded</button>
      </details>
    </Modal>,
  );
  const close = screen.getByRole("button", { name: "Close" });
  const summary = screen.getByText("More context");
  close.focus();
  fireEvent.keyDown(close, { key: "Tab" });
  expect(document.activeElement).toBe(summary);
  fireEvent.keyDown(summary, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(close);
});

it("treats the checked radio as its group's boundary tab stop", () => {
  render(
    <Modal
      title="Choose audience"
      onClose={vi.fn()}
      footer={<button>Apply audience</button>}
    >
      <label>
        <input type="radio" name="audience" />
        Tutors
      </label>
      <label>
        <input type="radio" name="audience" defaultChecked />
        Tutees
      </label>
      <label>
        <input type="radio" name="audience" />
        Everyone
      </label>
    </Modal>,
  );
  const selected = screen.getByRole("radio", { name: "Tutees" });
  const last = screen.getByRole("button", { name: "Apply audience" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(selected);
  fireEvent.keyDown(selected, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
});

it("uses the first enabled radio when no option is selected", () => {
  render(
    <Modal
      title="Choose audience"
      onClose={vi.fn()}
      footer={<button>Apply audience</button>}
    >
      <label>
        <input type="radio" name="audience" disabled />
        Unavailable
      </label>
      <label>
        <input type="radio" name="audience" />
        Tutors
      </label>
      <label>
        <input type="radio" name="audience" />
        Tutees
      </label>
    </Modal>,
  );
  const last = screen.getByRole("button", { name: "Apply audience" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "Tutors" }),
  );
});

it("keeps same-name radio groups in independent forms as separate tab stops", () => {
  render(
    <Modal title="Independent forms" onClose={vi.fn()} footer={null}>
      <form>
        <label>
          <input type="radio" name="answer" defaultChecked />
          First form
        </label>
      </form>
      <form>
        <label>
          <input type="radio" name="answer" defaultChecked />
          Second form
        </label>
      </form>
    </Modal>,
  );
  const first = screen.getByRole("radio", { name: "First form" });
  const last = screen.getByRole("radio", { name: "Second form" });
  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(first);
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(last);
});

it("keeps focus on the dialog when every control is disabled", () => {
  render(
    <Modal
      title="Saving meeting"
      busy
      onClose={vi.fn()}
      footer={<button disabled>Saving…</button>}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Saving meeting" });
  expect(document.activeElement).toBe(dialog);
  expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(dialog);
  expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(dialog);
});

it("blocks cancellation while busy and recovers focus when the active control becomes disabled", () => {
  const onClose = vi.fn();
  const content = (busy: boolean) => (
    <Modal
      title="Save meeting"
      busy={busy}
      onClose={onClose}
      footer={
        <button data-dialog-autofocus disabled={busy}>
          Cancel
        </button>
      }
    />
  );
  const view = render(content(false));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
  view.rerender(content(true));
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(dialog);
  const busyCancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, busyCancel);
  expect(busyCancel.defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(content(false));
  const idleCancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, idleCancel);
  expect(idleCancel.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
});

it("recovers dialog focus after the browser blurs a disabled fieldset control to body", () => {
  const content = (busy: boolean) => (
    <Modal title="Save profile" busy={busy} onClose={vi.fn()} footer={null}>
      <fieldset disabled={busy}>
        <button data-dialog-autofocus>Save</button>
      </fieldset>
    </Modal>
  );
  const view = render(content(false));
  screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).blur();
  expect(document.activeElement).toBe(document.body);
  view.rerender(content(true));
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(dialog);
  expect(fireEvent.keyDown(dialog, { key: "Escape" })).toBe(false);
});
