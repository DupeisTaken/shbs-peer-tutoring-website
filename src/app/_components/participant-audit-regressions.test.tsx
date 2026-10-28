// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { AvailabilityEditor } from "../(tutor)/_components/availability-editor";
import { PersonalTutorHistory } from "../history/personal-tutor-history";
import { TuteeHistoryContent } from "./tutee-history";
import { NotificationBell } from "./notification-bell";
import { EmailPreferences } from "./account-emails";
import { notificationCategories } from "~/lib/notification-categories";

// Audit regressions exercise real presentation boundaries with deterministic failed reads.
// No database, server, browser process or external notification provider is needed.
const state = vi.hoisted(() => ({
  availability: vi.fn(),
  notifications: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  emailSettings: vi.fn(),
  unread: vi.fn(),
  mark: vi.fn(),
  markError: null as Error | null,
  acceptPreferences: undefined as undefined | (() => Promise<void>),
}));
const date = new Date("2026-10-20T00:00:00.000Z");
const history = {
  record: { id: "record", name: "Historical participant", gradeLevel: null },
  term: null,
  owner: null,
  count: 1,
  sessions: [
    {
      status: "PRESENT",
      session: {
        id: "session",
        date,
        schoolYear: "26-27",
        quarter: "Q1",
        pairing: { subject: "Mathematics" },
        tutor: { englishName: "Tutor" },
      },
    },
  ],
};
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      notification: {
        list: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
    }),
    account: {
      notificationPreferences: {
        useQuery: () => {
          const result = state.emailSettings() as {
            data?: {
              enabled: boolean;
              emailMessages: boolean;
              emailInfo: boolean;
              emailSecondaryRecipients: boolean;
            };
            [key: string]: unknown;
          };
          const data = result.data;
          return {
            ...result,
            data: data
              ? {
                  emailEnabled: data.enabled,
                  emailSecondaryRecipients: data.emailSecondaryRecipients,
                  categories: notificationCategories.map((category) => ({
                    category,
                    badgeEnabled: true,
                    emailEnabled:
                      category === "messages"
                        ? data.emailMessages
                        : data.emailInfo,
                    badgeAvailable: category !== "reminders",
                    emailEditable: data.enabled,
                  })),
                }
              : undefined,
          };
        },
      },
      setNotificationPreferences: {
        useMutation: (options: {
          onSuccess: () => Promise<void>;
          onSettled: () => void;
        }) => {
          state.acceptPreferences = async () => {
            await options.onSuccess();
            options.onSettled();
          };
          return { mutate: state.save, isPending: false };
        },
      },
    },
    tutor: {
      myAvailability: { useQuery: state.availability },
      setAvailability: {
        useMutation: () => ({
          mutate: state.save,
          reset: vi.fn(),
          isPending: false,
        }),
      },
    },
    notification: {
      list: { useQuery: state.notifications },
      unreadCount: { useQuery: state.unread },
      markRead: {
        useMutation: () => ({ mutate: state.mark, error: state.markError }),
      },
      markAllRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    tuteeHistory: {
      details: { useQuery: () => ({ data: history }) },
      myDetails: { useQuery: () => ({ data: history }) },
      myTutorRecords: {
        useQuery: () => ({
          data: [
            {
              id: "tutor",
              englishName: "Tutor",
              periods: ["26-27 Q1"],
              sessionCount: 1,
              meetingCount: 1,
              amendmentCount: 0,
              storedSessionHours: 1,
            },
          ],
        }),
      },
      myTutorDetails: {
        useQuery: () => ({
          data: {
            record: { id: "tutor", englishName: "Tutor" },
            counts: { sessions: 1, meetings: 1, amendments: 0 },
            periods: ["26-27 Q1"],
            firstSessionDate: date,
            lastSessionDate: date,
            sessions: [
              {
                id: "session",
                date,
                schoolYear: "26-27",
                quarter: "Q1",
                tutorStatus: "PRESENT",
                shCount: 1,
                pairing: { subject: "Mathematics" },
              },
            ],
            meetings: [
              {
                id: "meeting-attendance",
                status: "PRESENT",
                meeting: { title: "Real meeting", date },
              },
            ],
            amendments: [],
            more: false,
            sessionMore: false,
            meetingMore: false,
            amendmentMore: false,
          },
        }),
      },
    },
  },
}));
const wrap = (children: ReactNode, locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="America/New_York"
  >
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  state.retry.mockReset();
  state.markError = null;
  state.unread.mockReturnValue({
    data: 0,
    isSuccess: true,
    refetch: state.retry,
  });
  state.availability.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: new Error("Read failed"),
    refetch: state.retry,
  });
  state.notifications.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: new Error("Read failed"),
    refetch: state.retry,
  });
  state.emailSettings.mockReturnValue({
    data: {
      enabled: true,
      emailMessages: true,
      emailInfo: false,
      emailReviewRequests: false,
      emailEventReminders: false,
      emailSecondaryRecipients: false,
    },
  });
});
afterEach(cleanup);

it("preserves an unsaved notification preference when a background settings read changes", () => {
  const view = render(wrap(<EmailPreferences />));
  const field = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Private messages: email",
  });
  fireEvent.click(field);
  expect(field.checked).toBe(false);
  // Another account surface or browser tab can invalidate this same settings query.
  state.emailSettings.mockReturnValue({
    data: {
      enabled: true,
      emailMessages: true,
      emailInfo: true,
      emailReviewRequests: false,
      emailEventReminders: false,
      emailSecondaryRecipients: false,
    },
  });
  view.rerender(wrap(<EmailPreferences />));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Private messages: email",
    }).checked,
  ).toBe(false);
});

it("preserves dirty preferences through a failed read and explicit read recovery", () => {
  const data = {
    enabled: true,
    emailMessages: true,
    emailInfo: false,
    emailReviewRequests: false,
    emailEventReminders: false,
    emailSecondaryRecipients: false,
  };
  state.emailSettings.mockReturnValue({ data, refetch: state.retry });
  const view = render(wrap(<EmailPreferences />));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Private messages: email" }),
  );
  state.emailSettings.mockReturnValue({
    data,
    error: new Error("Offline"),
    refetch: state.retry,
  });
  view.rerender(wrap(<EmailPreferences />));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Private messages: email",
    }).checked,
  ).toBe(false);
  expect(
    screen
      .getByRole("checkbox", { name: "Private messages: email" })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.emailSettings.mockReturnValue({
    data,
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap(<EmailPreferences />));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Private messages: email",
    }).checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.cancel }));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Private messages: email",
    }).checked,
  ).toBe(true);
});

it("locks accepted preferences during failed synchronization and only retries the read", async () => {
  const data = {
    enabled: true,
    emailMessages: true,
    emailInfo: false,
    emailReviewRequests: false,
    emailEventReminders: false,
    emailSecondaryRecipients: false,
  };
  state.emailSettings.mockReturnValue({ data, refetch: state.retry });
  state.retry.mockRejectedValueOnce(new Error("Offline"));
  const view = render(wrap(<EmailPreferences />));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Private messages: email" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.emailPreferences.save }),
  );
  await act(async () => state.acceptPreferences!());
  expect(
    screen
      .getByRole("button", { name: en.emailPreferences.save })
      .matches(":disabled"),
  ).toBe(true);
  const accepted = { ...data, emailMessages: false, emailInfo: true };
  state.emailSettings.mockReturnValue({
    data: accepted,
    refetch: state.retry,
    isSuccess: true,
  });
  state.retry.mockResolvedValue({ data: accepted, isSuccess: true });
  view.rerender(wrap(<EmailPreferences />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  expect(state.save).toHaveBeenCalledOnce();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Other program updates: email",
    }).checked,
  ).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
  // The cleared draft follows future server snapshots until another edit starts.
  state.emailSettings.mockReturnValue({
    data: { ...accepted, emailMessages: true },
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap(<EmailPreferences />));
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Private messages: email",
    }).checked,
  ).toBe(true);
});

it("does not describe an unavailable availability query as an empty catalog", () => {
  render(wrap(<AvailabilityEditor />));
  expect(screen.queryByText(en.tutor.availability.empty)).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("distinguishes initial availability loading from a successfully empty catalog", () => {
  state.availability.mockReturnValue({
    data: undefined,
    isLoading: true,
    refetch: state.retry,
  });
  const view = render(wrap(<AvailabilityEditor />));
  expect(screen.getByRole("status").textContent).toContain(
    en.tutor.availability.loading,
  );
  expect(screen.queryByText(en.tutor.availability.empty)).toBeNull();
  state.availability.mockReturnValue({
    data: { slots: [], selectedSlotIds: [] },
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  expect(screen.getByText(en.tutor.availability.empty)).toBeTruthy();
});

it("retains but blocks the availability draft while its cached read has failed", () => {
  state.availability.mockReturnValue({
    data: {
      slots: [
        {
          id: "slot",
          label: "Morning",
          dayOfWeek: 1,
          startMin: 480,
          endMin: 540,
        },
      ],
      selectedSlotIds: ["slot"],
    },
    isLoading: false,
    error: new Error("Read failed"),
    refetch: state.retry,
  });
  render(wrap(<AvailabilityEditor />));
  const slot = screen.getByRole<HTMLButtonElement>("button", {
    name: "Morning (08:00–09:00)",
  });
  expect(slot.getAttribute("aria-pressed")).toBe("true");
  expect(slot.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.availability.save }),
  );
  expect(state.save).not.toHaveBeenCalled();
});

it("retains an availability edit through read failure/retry and conceals revoked data", () => {
  const data = {
    slots: [
      {
        id: "slot",
        label: "Morning",
        dayOfWeek: 1,
        startMin: 480,
        endMin: 540,
      },
    ],
    selectedSlotIds: ["slot"],
  };
  state.availability.mockReturnValue({
    data,
    isSuccess: true,
    refetch: state.retry,
  });
  const view = render(wrap(<AvailabilityEditor />));
  fireEvent.click(screen.getByRole("button", { name: /Morning/ }));
  state.availability.mockReturnValue({
    data,
    error: new Error("Offline"),
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  state.availability.mockReturnValue({
    data,
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  expect(
    screen
      .getByRole("button", { name: /Morning/ })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  state.availability.mockReturnValue({
    data,
    error: { data: { code: "FORBIDDEN" } },
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  expect(screen.queryByRole("button", { name: /Morning/ })).toBeNull();
  state.availability.mockReturnValue({
    data,
    error: new Error("Offline"),
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  expect(screen.queryByRole("button", { name: /Morning/ })).toBeNull();
  state.availability.mockReturnValue({
    data,
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap(<AvailabilityEditor />));
  expect(
    screen
      .getByRole("button", { name: /Morning/ })
      .getAttribute("aria-pressed"),
  ).toBe("false");
});

it("does not describe a failed notification read as an empty inbox", () => {
  render(wrap(<NotificationBell />));
  fireEvent.click(screen.getByLabelText(en.components.notifications.title));
  expect(screen.queryByText(en.components.notifications.empty)).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("retains cached notices on read failure, retries the list and both counts, and conceals denied notices", async () => {
  const data = [
    {
      id: "notice",
      title: "Synthetic notice",
      body: null,
      link: null,
      event: null,
      context: null,
      createdAt: date,
      readAt: null,
    },
  ];
  state.notifications.mockReturnValue({
    data,
    error: new Error("Offline"),
    refetch: state.retry,
  });
  const view = render(wrap(<NotificationBell />));
  fireEvent.click(screen.getByLabelText(en.components.notifications.title));
  expect(screen.getByText("Synthetic notice")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: /Synthetic notice/ })
      .matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  expect(state.retry).toHaveBeenCalledTimes(3);
  state.notifications.mockReturnValue({
    data,
    error: { data: { code: "FORBIDDEN" } },
    refetch: state.retry,
  });
  view.rerender(wrap(<NotificationBell />));
  expect(screen.queryByText("Synthetic notice")).toBeNull();
});

it("announces unread-count and mark-read failures without hiding cached notices", () => {
  const data = [
    {
      id: "notice",
      title: "Synthetic notice",
      body: null,
      link: null,
      event: null,
      context: null,
      createdAt: date,
      readAt: null,
    },
  ];
  state.notifications.mockReturnValue({
    data,
    refetch: state.retry,
    isSuccess: true,
  });
  state.unread.mockReturnValue({
    data: 1,
    error: new Error("Count failed"),
    refetch: state.retry,
  });
  const view = render(wrap(<NotificationBell />));
  fireEvent.click(screen.getByLabelText(en.components.notifications.title));
  expect(screen.getByRole("alert")).toBeTruthy();
  state.unread.mockReturnValue({
    data: 1,
    isSuccess: true,
    refetch: state.retry,
  });
  state.markError = new Error("Mark read failed");
  view.rerender(wrap(<NotificationBell />));
  expect(screen.getByRole("alert").textContent).toContain("Mark read failed");
  expect(screen.getByText("Synthetic notice")).toBeTruthy();
});

it.each(["en", "zh"] as const)(
  "keeps the %s tutee attendance calendar date in a western program timezone",
  (locale) => {
    render(wrap(<TuteeHistoryContent tuteeId="record" personal />, locale));
    const expected = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
    expect(screen.getByText(expected)).toBeTruthy();
  },
);

it.each(["en", "zh"] as const)(
  "keeps the %s tutor attendance calendar date in a western program timezone",
  (locale) => {
    const messages = locale === "en" ? en : zh;
    render(wrap(<PersonalTutorHistory />, locale));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(messages.tuteeHistory.details),
      }),
    );
    const expected = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
    expect(screen.getByText(`${expected} · Mathematics`)).toBeTruthy();
    // Meetings represent instants, so their dates must still use the school timezone.
    const meetingDay = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "America/New_York",
    }).format(date);
    expect(
      screen.getByText(new RegExp(`${meetingDay} · Real meeting`)),
    ).toBeTruthy();
  },
);
