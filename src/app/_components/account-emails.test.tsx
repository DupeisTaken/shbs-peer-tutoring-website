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
  binding: vi.fn(),
  canEdit: true,
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
            canEdit: mocks.canEdit,
            secondaryEmailBindingEnabled: true,
            deliveryAvailable: true,
            failed: 0,
          },
        }),
      },
      setEmailNotifications: { useMutation: () => ({ mutate: mocks.program }) },
      setSecondaryEmailBinding: {
        useMutation: () => ({ mutate: mocks.binding }),
      },
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
  mocks.canEdit = true;
  mocks.data = {
    email: "primary@example.test",
    emails: [
      { email: "primary@example.test", verifiedAt: new Date() },
      { email: "secondary@example.test", verifiedAt: new Date() },
      { email: "pending@example.test", verifiedAt: null },
    ],
    enabled: true,
    secondaryEmailBindingEnabled: true,
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
    screen.getByText(/account security alerts always remain available/),
  ).toBeTruthy();
});

it("blocks additions and pending verification while keeping existing addresses manageable", () => {
  mocks.data = { ...mocks.data, secondaryEmailBindingEnabled: false };
  view(<AccountEmails />);
  expect(screen.getByText(/binding is disabled/)).toBeTruthy();
  expect(screen.queryByLabelText("Add a secondary email")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Verify" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(mocks.manage).toHaveBeenCalledWith({
    email: "secondary@example.test",
    currentPassword: "synthetic-password",
    action: "remove",
  });
  expect(screen.getByText(/Secondary emails are optional/)).toBeTruthy();
});

it("supports accounts without secondary addresses and does not offer a security opt-out", () => {
  mocks.data = {
    ...mocks.data,
    emails: [{ email: "primary@example.test", verifiedAt: new Date() }],
  };
  view(
    <>
      <AccountEmails />
      <EmailPreferences />
    </>,
  );
  expect(screen.getByText("primary@example.test")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Security/ })).toBeNull();
  expect(
    screen.getByRole("checkbox", { name: /Messages/ }).hasAttribute("disabled"),
  ).toBe(false);
});

it("saves binding availability independently of the notification gate", () => {
  view(<ProgramEmailSettings />);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Allow secondary-email binding" }),
  );
  expect(mocks.binding).toHaveBeenCalledWith({
    enabled: false,
    expectedEnabled: true,
  });
  expect(mocks.program).not.toHaveBeenCalled();
});

it("shows read-only program availability without admin controls", () => {
  mocks.canEdit = false;
  view(<ProgramEmailSettings />);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.getByText("Secondary-email binding")).toBeTruthy();
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
