// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), change: vi.fn(), succeed: true }));
vi.mock("~/lib/password-session", () => ({ signInAfterPasswordChange: mocks.redirect }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./membership-editor", () => ({ MembershipEditor: () => null }));
vi.mock("./account-emails", () => ({ AccountEmails: () => null, EmailPreferences: () => null }));
vi.mock("./two-factor-settings", () => ({ TwoFactorSettings: () => null }));
vi.mock("~/trpc/react", () => {
  const inert = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  const code = { useMutation: (options: { onSuccess: (data: { email: string }) => void }) => ({
    mutate: () => options.onSuccess({ email: "s***@example.test" }), isPending: false,
  }) };
  const change = { useMutation: (options: { onSuccess: () => void }) => ({
    mutate: (input: unknown) => { mocks.change(input); if (mocks.succeed) options.onSuccess(); }, isPending: false,
  }) };
  const empty = { useQuery: () => ({ data: null }) };
  return { api: {
    useUtils: () => ({}),
    program: { features: { useQuery: () => ({ data: { EMAIL_2FA: true } }) } },
    account: { me: empty, updateName: inert, requestPasswordChangeCode: code, changePassword: change },
    tutor: { myProfile: empty, me: empty, myStatusRequest: empty, updateProfile: inert,
      requestOptOut: inert, requestReentry: inert, recallStatusRequest: inert,
      requestPasswordChangeCode: code, changePassword: change },
  } };
});
import { AccountSettings } from "./account-settings";
import TutorSettings from "../(tutor)/settings/page";

beforeEach(() => { mocks.redirect.mockReset(); mocks.change.mockReset(); mocks.succeed = true; });
afterEach(cleanup);

// Submit the actual rendered two-step form. Only a successful server response leaves the workspace.
it.each([AccountSettings, TutorSettings])("returns to sign-in after a successful password change (%s)", (Component) => {
  render(<NextIntlClientProvider locale="en" messages={en}><Component /></NextIntlClientProvider>);
  fireEvent.change(screen.getByLabelText(en.tutor.settings.currentPassword), { target: { value: "CurrentPassword123!" } });
  fireEvent.change(screen.getByLabelText(new RegExp(`^${en.tutor.settings.newPassword}`)), { target: { value: "NewPassword456!" } });
  fireEvent.change(screen.getByLabelText(en.tutor.settings.confirmPassword), { target: { value: "NewPassword456!" } });
  fireEvent.click(screen.getByRole("button", { name: en.account.password.sendCode }));
  const codeInput = document.querySelector('input[autocomplete="one-time-code"]');
  expect(codeInput).toBeTruthy();
  fireEvent.change(codeInput!, { target: { value: "ABCDE" } });
  mocks.succeed = false;
  fireEvent.click(screen.getByRole("button", { name: en.tutor.settings.changePasswordBtn }));
  expect(mocks.redirect).not.toHaveBeenCalled();
  mocks.succeed = true;
  fireEvent.click(screen.getByRole("button", { name: en.tutor.settings.changePasswordBtn }));
  expect(mocks.change).toHaveBeenLastCalledWith({ currentPassword: "CurrentPassword123!", newPassword: "NewPassword456!", code: "ABCDE" });
  expect(mocks.redirect).toHaveBeenCalledOnce();
});
