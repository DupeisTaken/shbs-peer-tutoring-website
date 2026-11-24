// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  emailSettings: {
    email: "primary-only@example.test",
    deliveryAvailable: true,
    secondaryEmailBindingEnabled: false,
    emails: [{ email: "primary-only@example.test", verifiedAt: new Date() }],
  },
}));

vi.mock("~/lib/password-session", () => ({
  signInAfterPasswordChange: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));
vi.mock("./school-departure", () => ({
  SchoolDeparturePanel: () => null,
  SchoolDepartureAction: () => null,
}));
vi.mock("./membership-editor", () => ({ MembershipEditor: () => null }));
vi.mock("./academic-profile", () => ({ AcademicPanel: () => null }));
vi.mock("./tutor-workload-preference", () => ({
  TutorWorkloadPreference: () => null,
}));
vi.mock("./two-factor-settings", () => ({ TwoFactorSettings: () => null }));
vi.mock("~/trpc/react", async () => {
  const inert = {
    useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false }),
  };
  const empty = {
    useQuery: () => ({
      data: null,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    }),
  };
  return {
    api: {
      useUtils: () => ({
        account: {
          emailSettings: { invalidate: vi.fn() },
          me: { invalidate: vi.fn() },
          notificationPreferences: { invalidate: vi.fn() },
        },
        tutor: { myProfile: { invalidate: vi.fn() } },
        notification: {
          list: { invalidate: vi.fn() },
          unreadCount: { invalidate: vi.fn() },
        },
      }),
      program: {
        ...(
          await import("~/test/name-field-policy-fixtures")
        ).nameFieldPolicyQueries(),
        profilePolicy: {
          useQuery: () => ({
            data: {
              requireLatinNames: false,
              offeredGrades: Array.from({ length: 12 }, (_, i) => i + 1),
              currentSchoolYear: "26-27",
            },
          }),
        },
        features: {
          useQuery: () => ({
            data: { EMAIL_2FA: false, EMAIL_DELIVERY_AVAILABLE: true },
          }),
        },
      },
      account: {
        me: empty,
        emailSettings: {
          useQuery: () => ({
            data: mocks.emailSettings,
            isSuccess: true,
            isFetching: false,
            refetch: vi.fn().mockResolvedValue({
              isSuccess: true,
              data: mocks.emailSettings,
            }),
          }),
        },
        notificationPreferences: {
          useQuery: () => ({
            data: {
              categories: [],
              emailEnabled: true,
              emailSecondaryRecipients: false,
              emailLocale: "en",
            },
            isSuccess: true,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
        requestSecondaryEmail: inert,
        confirmSecondaryEmail: inert,
        manageSecondaryEmail: inert,
        requestEmailChange: {
          useMutation: () => ({
            mutate: mocks.requestEmailChange,
            reset: vi.fn(),
            isPending: false,
          }),
        },
        confirmEmailChange: {
          useMutation: () => ({
            mutate: mocks.confirmEmailChange,
            reset: vi.fn(),
            isPending: false,
          }),
        },
        setNotificationPreferences: inert,
        updateName: inert,
        requestPasswordChangeCode: inert,
        changePassword: inert,
      },
      tutor: {
        myProfile: empty,
        me: empty,
        myStatusRequest: empty,
        updateProfile: inert,
        requestOptOut: inert,
        requestReentry: inert,
        recallStatusRequest: inert,
        requestPasswordChangeCode: inert,
        changePassword: inert,
      },
    },
  };
});

import { AccountSettings } from "./account-settings";
import TutorSettingsPage from "../(tutor)/settings/page";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it.each([
  {
    surface: "AccountSettings (/my-account)",
    node: () => <AccountSettings embedded />,
  },
  {
    surface: "TutorSettingsPage (/settings)",
    node: () => <TutorSettingsPage />,
  },
])(
  "exposes primary-email replacement for a primary-only account when secondary binding is disabled ($surface)",
  ({ node }) => {
    for (const [locale, messages] of [
      ["en", en],
      ["zh", zh],
    ] as const) {
      cleanup();
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={qc}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {node()}
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
      expect(
        screen.getByText(messages.accountEmails.bindingDisabled),
      ).toBeTruthy();
      expect(
        screen.queryByLabelText(messages.accountEmails.addLabel),
      ).toBeNull();
      const summary = screen.getByText(messages.emailChange.title);
      const details = summary.closest("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
      const emailField = within(details).getByLabelText<HTMLInputElement>(
        messages.emailChange.email,
      );
      const passwordField = within(details).getByLabelText<HTMLInputElement>(
        messages.emailChange.password,
      );
      fireEvent.change(emailField, {
        target: { value: "replacement@example.test" },
      });
      fireEvent.change(passwordField, {
        target: { value: "CurrentPass123!" },
      });
      fireEvent.submit(emailField.closest("form")!);
      expect(mocks.requestEmailChange).toHaveBeenCalledWith({
        email: "replacement@example.test",
        currentPassword: "CurrentPass123!",
      });
    }
  },
);
