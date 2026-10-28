// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { notificationCategories } from "~/lib/notification-categories";
import type { NotificationPreferenceAvailability } from "./notification-preference-fields";

const mocks = vi.hoisted(() => ({
  data: {},
  preferenceData: {
    categories: [] as NotificationPreferenceAvailability[],
    emailEnabled: true,
    emailSecondaryRecipients: false,
  },
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
      notification: {
        list: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
    }),
    account: {
      emailSettings: { useQuery: () => ({ data: mocks.data }) },
      notificationPreferences: {
        useQuery: () => ({ data: mocks.preferenceData }),
      },
      requestSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.request, reset: vi.fn() }),
      },
      confirmSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.confirm, reset: vi.fn() }),
      },
      manageSecondaryEmail: {
        useMutation: () => ({ mutate: mocks.manage, reset: vi.fn() }),
      },
      setNotificationPreferences: {
        useMutation: () => ({ mutate: mocks.preferences }),
      },
    },
    program: {
      resendStuckEmails: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      emailDeliveryStatus: {
        useQuery: () => ({
          data: {
            channels: ["SECURITY", "PROGRAM"].map((category) => ({
              category,
              state: "LOCAL",
              checkedAt: new Date("2026-10-09T03:00:00Z"),
            })),
            retrying: 0,
            failed: 0,
          },
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
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
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      {component}
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.preferenceData = {
    categories: notificationCategories.map((category) => ({
      category,
      badgeEnabled: true,
      emailEnabled: false,
      badgeAvailable: category !== "reminders",
      emailEditable: true,
    })),
    emailEnabled: true,
    emailSecondaryRecipients: false,
  };
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
    canReceiveReviewRequests: true,
    emailMessages: false,
    emailInfo: false,
    emailReviewRequests: false,
    emailEventReminders: false,
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

it.each([
  ["00-12", "0012"],
  ["abcde", "ABCDE"],
])(
  "verifies code %s for the selected pending address and scopes cancellation to it",
  (draft, code) => {
    view(<AccountEmails />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: (name) => name.startsWith(messages.codes.emailLabel),
      }),
      { target: { value: draft } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[1]!);
    expect(mocks.confirm).toHaveBeenCalledWith({
      email: "pending@example.test",
      code,
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
  },
);

it("saves badge and email categories independently", () => {
  view(<EmailPreferences />);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Tutoring assignments: unread badge",
    }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Attendance and discipline: email" }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Include verified/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(mocks.preferences).toHaveBeenCalledWith({
    categories: notificationCategories.map((category) => ({
      category,
      badgeEnabled: category !== "tutoring",
      emailEnabled: category === "attendance",
    })),
    emailSecondaryRecipients: true,
  });
});

it.each(["en", "zh"] as const)(
  "labels every available channel in %s",
  (locale) => {
    const catalog = locale === "zh" ? zh : messages;
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={catalog}
        timeZone="Asia/Shanghai"
      >
        <EmailPreferences />
      </NextIntlClientProvider>,
    );
    for (const category of notificationCategories) {
      const label = catalog.notificationPreferences.categories[category];
      expect(
        screen.getByRole("checkbox", {
          name: catalog.notificationPreferences.emailFor.replace(
            "{category}",
            label,
          ),
        }),
      ).toBeTruthy();
      if (category !== "reminders")
        expect(
          screen.getByRole("checkbox", {
            name: catalog.notificationPreferences.badgeFor.replace(
              "{category}",
              label,
            ),
          }),
        ).toBeTruthy();
    }
    expect(
      screen.getByText(catalog.notificationPreferences.emailOnly),
    ).toBeTruthy();
    expect(
      screen.getByText(catalog.notificationPreferences.essential),
    ).toBeTruthy();
  },
);

it("keeps badge preferences editable when optional email is disabled", () => {
  mocks.preferenceData.emailEnabled = false;
  mocks.preferenceData.categories = mocks.preferenceData.categories.map(
    (row) => ({ ...row, emailEditable: false }),
  );
  view(<EmailPreferences />);
  expect(
    screen.getByText(messages.notificationPreferences.disabled),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("checkbox", { name: "Tutoring assignments: email" })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Tutoring assignments: unread badge",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(mocks.preferences).toHaveBeenCalledWith({
    categories: notificationCategories.map((category) => ({
      category,
      badgeEnabled: category !== "tutoring",
      emailEnabled: false,
    })),
  });
});

it("keeps historical review badge available without reviewer email eligibility", () => {
  mocks.preferenceData.categories = mocks.preferenceData.categories.map(
    (row) =>
      row.category === "reviews" ? { ...row, emailEditable: false } : row,
  );
  view(<EmailPreferences />);
  expect(
    screen
      .getByRole("checkbox", { name: "Review requests: email" })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("checkbox", { name: "Review requests: unread badge" })
      .matches(":disabled"),
  ).toBe(false);
  expect(
    screen.queryByRole("checkbox", {
      name: "Upcoming reminders: unread badge",
    }),
  ).toBeNull();
});

it("does not submit a stale email enabling draft after the global gate closes", () => {
  const rendered = view(<EmailPreferences />);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Review requests: email" }),
  );
  mocks.preferenceData = {
    ...mocks.preferenceData,
    emailEnabled: false,
    categories: mocks.preferenceData.categories.map((row) => ({
      ...row,
      emailEditable: false,
    })),
  };
  rendered.rerender(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <EmailPreferences />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Review requests: unread badge" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(mocks.preferences).toHaveBeenCalledWith({
    categories: notificationCategories.map((category) => ({
      category,
      badgeEnabled: category !== "reviews",
      emailEnabled: false,
    })),
  });
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
    screen
      .getByRole("checkbox", { name: "Private messages: email" })
      .hasAttribute("disabled"),
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
  expect(screen.getByText("Secondary-Email Binding")).toBeTruthy();
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
