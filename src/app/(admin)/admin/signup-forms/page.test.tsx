// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import SignupFormsPage from "./page";
import { FieldDialog } from "~/app/_components/signup-field-dialog";
import { signupSettings } from "~/lib/signup-fields";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  error: null as null | { message: string; data: { approvalId: string } },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    program: {
      signupFieldSettings: { useQuery: mocks.query },
      setSignupField: {
        useMutation: () => ({ mutate: mocks.mutate, reset: mocks.reset, error: mocks.error }),
      },
    },
    useUtils: () => ({
      program: { signupFieldSettings: { invalidate: mocks.invalidate } },
      tutee: { signupOptions: { invalidate: mocks.invalidate } },
      application: { options: { invalidate: mocks.invalidate } },
    }),
  },
}));
const wrap = (child: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {child}
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  // jsdom lacks dialog's browser focus/inert implementation; real keyboard trapping is audited in-browser.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  mocks.query.mockReturnValue({
    data: {
      fields: signupSettings(null),
      canEdit: true,
      secondaryEmailBindingEnabled: true,
    },
  });
});
afterEach(cleanup);
it("shows locked essentials without edit controls and sends a field-specific expected state", () => {
  wrap(<SignupFormsPage />);
  expect(
    screen.queryByRole("button", { name: "Configure Preferred Name" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Configure Policy acceptance" }),
  ).toBeNull();
  const trigger = screen.getByRole("button", {
    name: "Configure How can we reach you?",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "How can we reach you?" });
  expect(dialog.getAttribute("aria-describedby")).toBe("signup-field-help");
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  fireEvent.click(screen.getByRole("button", { name: "Save field" }));
  expect(mocks.mutate).toHaveBeenCalledWith({
    form: "tutee",
    field: "preferredContact",
    state: "hidden",
    expectedState: "required",
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(trigger);
});
it("provides read-only settings for non-Head and explains secondary-email availability", () => {
  mocks.query.mockReturnValue({
    data: {
      fields: signupSettings(null),
      canEdit: false,
      secondaryEmailBindingEnabled: false,
    },
  });
  wrap(<SignupFormsPage />);
  expect(screen.queryByRole("button", { name: /^Configure / })).toBeNull();
  expect(screen.getByText(/Secondary-email binding is disabled/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tutor signup" }));
  expect(screen.getByText("Third subject")).toBeTruthy();
});
it("cancels on Escape without saving, retains errors and offers reload", () => {
  const close = vi.fn();
  const save = vi.fn();
  const reload = vi.fn();
  wrap(
    <FieldDialog
      label="Phone"
      initial="optional"
      pending={false}
      error="Settings changed"
      onClose={close}
      onSave={save}
      onReload={reload}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Settings changed");
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: false, cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  expect(reload).toHaveBeenCalledOnce();
});

it("contains Tab around the selected radio, keeps arrow keys native and holds focus while saving", () => {
  const props = {
    label: "Phone",
    initial: "optional" as const,
    pending: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onReload: vi.fn(),
  };
  const view = wrap(<FieldDialog {...props} error="Please retry" />);
  const selected = screen.getByRole("radio", { name: "Optional" });
  const save = screen.getByRole("button", { name: "Save field" });
  expect(document.activeElement).toBe(selected);
  fireEvent.keyDown(selected, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(save);
  fireEvent.keyDown(save, { key: "Tab" });
  expect(document.activeElement).toBe(selected);
  expect(fireEvent.keyDown(selected, { key: "ArrowDown" })).toBe(true);
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <FieldDialog {...props} pending />
    </NextIntlClientProvider>,
  );
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(dialog);
  expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(dialog);
  expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <FieldDialog {...props} />
    </NextIntlClientProvider>,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "Optional" }),
  );
});

it("retains a queued Admin field draft as pending instead of saved or failed", () => {
  const props = { label: "Phone", initial: "required" as const, pending: false, canApply: false, onClose: vi.fn(), onSave: vi.fn(), onReload: vi.fn() };
  const view = wrap(<FieldDialog {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  view.rerender(<NextIntlClientProvider locale="en" messages={en}><FieldDialog {...props} approvalId="request-1" /></NextIntlClientProvider>);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Hidden" }).checked).toBe(true);
  expect(screen.getByRole("status").textContent).toBe(en.approvals.queuedBody);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Reload settings" })).toBeNull();
  expect(props.onSave).toHaveBeenCalledWith("hidden");
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("preserves a queued field draft and expected state through failed and successful background refetches", async () => {
  const data = { fields: signupSettings(null), canEdit: true, canApply: false, secondaryEmailBindingEnabled: true };
  mocks.query.mockReturnValue({ data, refetch: mocks.refetch });
  const view = wrap(<SignupFormsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Configure How can we reach you?" }));
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  mocks.error = { message: "Queued", data: { approvalId: "request" } };
  mocks.query.mockReturnValue({ data, error: { message: "Refresh failed" }, refetch: mocks.refetch });
  view.rerender(<NextIntlClientProvider locale="en" messages={en}><SignupFormsPage /></NextIntlClientProvider>);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Hidden" }).checked).toBe(true);
  const live = { ...data, fields: { ...data.fields, tutee: { ...data.fields.tutee, preferredContact: "optional" as const } } };
  mocks.query.mockReturnValue({ data: live, refetch: mocks.refetch });
  view.rerender(<NextIntlClientProvider locale="en" messages={en}><SignupFormsPage /></NextIntlClientProvider>);
  expect(screen.getByText(en.approvals.queuedBody)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ state: "hidden", expectedState: "required" }));
  // A failed explicit reload also keeps the draft. Success alone adopts the live field version.
  mocks.error = { message: "Conflict", data: { approvalId: "" } };
  view.rerender(<NextIntlClientProvider locale="en" messages={en}><SignupFormsPage /></NextIntlClientProvider>);
  mocks.refetch.mockResolvedValueOnce({ isSuccess: false, error: { message: "Reload failed" } });
  fireEvent.click(screen.getByRole("button", { name: en.signupFields.reload }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Reload failed"));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Hidden" }).checked).toBe(true);
  mocks.refetch.mockResolvedValueOnce({ isSuccess: true, data: live });
  fireEvent.click(screen.getByRole("button", { name: en.signupFields.reload }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("radio", { name: "Optional" }).checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: en.approvals.requestHead }));
  expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ state: "optional", expectedState: "optional" }));
});
