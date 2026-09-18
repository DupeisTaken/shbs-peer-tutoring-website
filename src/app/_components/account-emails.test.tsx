// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";

const mocks = vi.hoisted(() => ({
  data: {},
  request: vi.fn(),
  confirm: vi.fn(),
  manage: vi.fn(),
  preferences: vi.fn(),
  program: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      account: {
        emailSettings: { invalidate: vi.fn() },
        me: { invalidate: vi.fn() },
      },
      tutor: { myProfile: { invalidate: vi.fn() } },
    }),
    account: {
      emailSettings: { useQuery: () => ({ data: mocks.data }) },
      requestSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.request, reset: vi.fn() }),
      },
      confirmSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.confirm, reset: vi.fn() }),
      },
      manageSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.manage, reset: vi.fn() }),
      },
      setEmailPreferences: {
        useMutation: () => ({ mutate: mocks.preferences }),
      },
    },
    program: {
      emailNotificationSettings: {
        useQuery: () => ({
          data: {
            enabled: false,
            canEdit: true,
            deliveryAvailable: true,
            failed: 0,
          },
        }),
      },
      setEmailNotifications: { useMutation: () => ({ mutate: mocks.program }) },
    },
  },
}));
import { AccountEmails, EmailPreferences } from "./account-emails";
import { ProgramEmailSettings } from "./program-email-settings";
const view = (component: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {component}
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = {
    email: "primary@example.test",
    emails: [
      { email: "primary@example.test", verifiedAt: new Date() },
      { email: "secondary@example.test", verifiedAt: new Date() },
      { email: "pending@example.test", verifiedAt: null },
    ],
    enabled: true,
    deliveryAvailable: true,
    emailSecurity: true,
    emailMessages: false,
    emailInfo: false,
    emailSecondaryRecipients: false,
  };
});
afterEach(cleanup);

it("requires a password to promote/remove/add while leaving code entry available", () => {
  view(<AccountEmails />);
  expect(
    screen
      .getByRole("button", { name: "Make primary" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
  expect(mocks.manage).toHaveBeenCalledWith({
    email: "secondary@example.test",
    currentPassword: "synthetic-password",
    action: "primary",
  });
  fireEvent.change(screen.getByLabelText("Add a secondary email"), {
    target: { value: "new@example.test" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  expect(mocks.request).toHaveBeenCalledWith({
    email: "new@example.test",
    currentPassword: "synthetic-password",
  });
});

it("verifies the selected pending address and scopes cancellation to it", () => {
  view(<AccountEmails />);
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "abcde" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[1]!);
  expect(mocks.confirm).toHaveBeenCalledWith({
    email: "pending@example.test",
    code: "ABCDE",
  });
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel pending" }));
  expect(mocks.manage).toHaveBeenCalledWith({
    email: "pending@example.test",
    currentPassword: "synthetic-password",
    action: "remove",
  });
});

it("saves independent categories and recipients", () => {
  view(<EmailPreferences />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Messages/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Include verified/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(mocks.preferences).toHaveBeenCalledWith({
    emailSecurity: true,
    emailMessages: true,
    emailInfo: false,
    emailSecondaryRecipients: true,
  });
});

it("disables preference editing behind the admin gate while explaining essential mail", () => {
  mocks.data = { ...mocks.data, enabled: false };
  view(<EmailPreferences />);
  expect(
    screen.getByText(/disabled by the program administrator/),
  ).toBeTruthy();
  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  expect(
    screen
      .getByRole("button", {
        name: "Save preferences",
      })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByText(/recovery emails always remain available/),
  ).toBeTruthy();
});

it("lets admins enable immediately with the current value for conflict checking", () => {
  view(<ProgramEmailSettings />);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Enable email notifications" }),
  );
  expect(mocks.program).toHaveBeenCalledWith({
    enabled: true,
    expectedEnabled: false,
  });
});
