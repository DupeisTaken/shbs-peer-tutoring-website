// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import SignupFormsPage from "./page";
import { FieldDialog } from "~/app/_components/signup-field-dialog";
import { signupSettings } from "~/lib/signup-fields";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), reset: vi.fn(), invalidate: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  program: { signupFieldSettings: { useQuery: mocks.query }, setSignupField: { useMutation: () => ({ mutate: mocks.mutate, reset: mocks.reset }) } },
  useUtils: () => ({ program: { signupFieldSettings: { invalidate: mocks.invalidate } }, tutee: { signupOptions: { invalidate: mocks.invalidate } }, application: { options: { invalidate: mocks.invalidate } } }),
} }));
const wrap = (child: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{child}</NextIntlClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lacks dialog's browser focus/inert implementation; real keyboard trapping is audited in-browser.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  mocks.query.mockReturnValue({ data: { fields: signupSettings(null), canEdit: true, secondaryEmailBindingEnabled: true } });
});
afterEach(cleanup);
it("shows locked essentials without edit controls and sends a field-specific expected state", () => {
  wrap(<SignupFormsPage />);
  expect(screen.queryByRole("button", { name: "Configure Full name" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Configure Policy acceptance" })).toBeNull();
  const trigger = screen.getByRole("button", { name: "Configure How can we reach you?" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "How can we reach you?" });
  expect(dialog.getAttribute("aria-describedby")).toBe("signup-field-help");
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  fireEvent.click(screen.getByRole("button", { name: "Save field" }));
  expect(mocks.mutate).toHaveBeenCalledWith({ form: "tutee", field: "preferredContact", state: "hidden", expectedState: "required" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(trigger);
});
it("provides read-only settings for non-Head and explains secondary-email availability", () => {
  mocks.query.mockReturnValue({ data: { fields: signupSettings(null), canEdit: false, secondaryEmailBindingEnabled: false } });
  wrap(<SignupFormsPage />);
  expect(screen.queryByRole("button", { name: /^Configure / })).toBeNull();
  expect(screen.getByText(/Secondary-email binding is disabled/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tutor signup" }));
  expect(screen.getByText("Third subject")).toBeTruthy();
});
it("cancels on Escape without saving, retains errors and offers reload", () => {
  const close = vi.fn(); const save = vi.fn(); const reload = vi.fn();
  wrap(<FieldDialog label="Phone" initial="optional" pending={false} error="Settings changed" onClose={close} onSave={save} onReload={reload} />);
  expect(screen.getByRole("alert").textContent).toBe("Settings changed");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  expect(reload).toHaveBeenCalledOnce();
});
