// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  notificationCategories,
  type NotificationLockValue,
} from "~/lib/notification-categories";
import { ProgramNotificationLocks } from "./program-notification-locks";
import { ProgramEmailSettings } from "./program-email-settings";

const mock = vi.hoisted(() => ({
  data: { categories: [] as NotificationLockValue[], canEdit: true },
  error: null as { message: string; data?: { code: string } } | null,
  saveError: null as { message: string; data?: { code: string } } | null,
  success: false,
  save: vi.fn(),
  reset: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      account: {
        notificationPreferences: { invalidate: mock.invalidate },
        emailSettings: { invalidate: mock.invalidate },
      },
      program: { emailNotificationSettings: { invalidate: mock.invalidate } },
      notification: {
        unreadCount: { invalidate: mock.invalidate },
        list: { invalidate: mock.invalidate },
      },
    }),
    program: {
      notificationLockSettings: {
        useQuery: () => ({
          data: mock.data,
          error: mock.error,
          refetch: mock.refetch,
          isFetching: false,
        }),
      },
      setNotificationLocks: {
        useMutation: () => ({
          mutateAsync: mock.save,
          reset: mock.reset,
          error: mock.saveError,
          isSuccess: mock.success,
        }),
      },
      emailNotificationSettings: { useQuery: () => ({ data: undefined }) },
      setEmailNotifications: { useMutation: () => ({}) },
      setSecondaryEmailBinding: { useMutation: () => ({}) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.data = {
    categories: notificationCategories.map((category) => ({
      category,
      badgeLocked: false,
      emailLocked: false,
    })),
    canEdit: true,
  };
  mock.error = null;
  mock.saveError = null;
  mock.success = false;
  mock.reset.mockImplementation(() => {
    mock.success = false;
    mock.saveError = null;
  });
  mock.save.mockResolvedValue({});
  mock.refetch.mockImplementation(() =>
    Promise.resolve({ isSuccess: true, data: mock.data }),
  );
});
afterEach(cleanup);
function content(
  locale: "en" | "zh",
  component = <ProgramNotificationLocks />,
) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      {component}
    </NextIntlClientProvider>
  );
}
const emailName = (locale: "en" | "zh") => {
  const t = locale === "en" ? en : zh;
  return t.notificationLocks.emailFor.replace(
    "{category}",
    t.notificationPreferences.categories.messages,
  );
};

it.each(["en", "zh"] as const)(
  "stages and cancels requirements, then saves its original snapshot in %s",
  async (locale) => {
    const t = locale === "en" ? en : zh;
    const view = render(content(locale));
    const email = screen.getByRole<HTMLInputElement>("checkbox", {
      name: emailName(locale),
    });
    const original = mock.data.categories.map((row) => ({ ...row }));
    fireEvent.click(email);
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.uiPatterns.cancel }));
    expect(email.checked).toBe(false);
    fireEvent.click(email);
    mock.data = {
      ...mock.data,
      categories: original.map((row) =>
        row.category === "tutoring" ? { ...row, badgeLocked: true } : row,
      ),
    };
    view.rerender(content(locale));
    fireEvent.click(
      screen.getByRole("button", { name: t.notificationLocks.save }),
    );
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    expect(mock.save).toHaveBeenCalledWith({
      expectedCategories: original,
      categories: original.map((row) =>
        row.category === "messages" ? { ...row, emailLocked: true } : row,
      ),
    });
    expect(
      screen.queryByRole("checkbox", {
        name: t.notificationLocks.badgeFor.replace(
          "{category}",
          t.notificationPreferences.categories.reminders,
        ),
      }),
    ).toBeNull();
  },
);

it("keeps a dirty requirements draft when switching delivery tabs", () => {
  render(content("en", <ProgramEmailSettings />));
  fireEvent.click(
    screen.getByRole("tab", { name: en.notificationLocks.requiredTab }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: emailName("en") }));
  fireEvent.click(
    screen.getByRole("tab", { name: en.notificationLocks.deliveryTab }),
  );
  fireEvent.click(
    screen.getByRole("tab", { name: en.notificationLocks.requiredTab }),
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: emailName("en") })
      .checked,
  ).toBe(true);
  expect(mock.save).not.toHaveBeenCalled();
});

it("clears the previous saved receipt when a new draft begins", () => {
  mock.success = true;
  render(content("en"));
  expect(screen.getByText(en.notificationLocks.saved)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: emailName("en") }));
  expect(mock.reset).toHaveBeenCalledOnce();
  expect(screen.queryByText(en.notificationLocks.saved)).toBeNull();
});

it("recovers an accepted write through reads without replaying it", async () => {
  mock.refetch.mockResolvedValueOnce({ isSuccess: false });
  render(content("en"));
  const email = screen.getByRole<HTMLInputElement>("checkbox", {
    name: emailName("en"),
  });
  fireEvent.click(email);
  const save = screen.getByRole<HTMLButtonElement>("button", {
    name: en.notificationLocks.save,
  });
  fireEvent.click(save);
  fireEvent.click(save);
  await screen.findByText(en.notificationLocks.refreshFailed);
  expect(mock.save).toHaveBeenCalledOnce();
  expect(email.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() => expect(email.disabled).toBe(false));
  expect(mock.refetch).toHaveBeenCalledTimes(2);
  expect(mock.save).toHaveBeenCalledOnce();
});

it("retains rejected drafts and hides cached requirements after access is denied", async () => {
  mock.save.mockRejectedValueOnce(new Error("Conflict"));
  const view = render(content("en"));
  fireEvent.click(screen.getByRole("checkbox", { name: emailName("en") }));
  fireEvent.click(
    screen.getByRole("button", { name: en.notificationLocks.save }),
  );
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: emailName("en") })
      .checked,
  ).toBe(true);
  mock.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(content("en"));
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("renders read-only requirements without save controls", () => {
  mock.data.canEdit = false;
  render(content("en"));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: emailName("en") })
      .disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: en.notificationLocks.save }),
  ).toBeNull();
});
