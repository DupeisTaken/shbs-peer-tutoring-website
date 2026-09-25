// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), change: vi.fn(), updateName: vi.fn(), succeed: true,
  account: null as null | { id: string; name: string; username: null; email: null; alternativeNames: string | null; role: string; profileVersion: number },
}));
vi.mock("~/lib/password-session", () => ({ signInAfterPasswordChange: mocks.redirect }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./membership-editor", () => ({ MembershipEditor: () => null }));
vi.mock("./academic-profile", () => ({ AcademicPanel: () => null }));
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
    program: { profilePolicy: { useQuery: () => ({ data: { requireLatinNames: false, offeredGrades: Array.from({ length: 12 }, (_, i) => i + 1), currentSchoolYear: "26-27" } }) }, features: { useQuery: () => ({ data: { EMAIL_2FA: true } }) } },
    account: { me: { useQuery: () => ({ data: mocks.account }) }, updateName: { useMutation: () => ({ mutate: mocks.updateName, isPending: false }) }, requestPasswordChangeCode: code, changePassword: change },
    tutor: { myProfile: empty, me: empty, myStatusRequest: empty, updateProfile: inert,
      requestOptOut: inert, requestReentry: inert, recallStatusRequest: inert,
      requestPasswordChangeCode: code, changePassword: change },
  } };
});
import { AccountSettings } from "./account-settings";
import TutorSettings from "../(tutor)/settings/page";

beforeEach(() => { mocks.redirect.mockReset(); mocks.change.mockReset(); mocks.updateName.mockReset(); mocks.succeed = true; mocks.account = null; });
afterEach(cleanup);

it("preserves an unsaved name draft and its original version when academic changes refetch the account", () => {
  mocks.account = { id: "self", name: "Original Name", username: null, email: null, alternativeNames: null, role: "STUDENT", profileVersion: 3 };
  const ui = () => <NextIntlClientProvider locale="en" messages={en}><AccountSettings /></NextIntlClientProvider>;
  const view = render(ui());
  fireEvent.change(screen.getByDisplayValue("Original Name"), { target: { value: "Draft Name" } });
  mocks.account = { ...mocks.account, name: "Other Editor", profileVersion: 4 };
  view.rerender(ui());
  expect(screen.getByDisplayValue("Draft Name")).toBeTruthy();
  expect(screen.getByText(en.academics.usernameMissing)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.tutor.settings.save }));
  expect(mocks.updateName).toHaveBeenCalledWith(expect.objectContaining({ name: "Draft Name", expectedProfileVersion: 3 }), expect.any(Object));
});

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
