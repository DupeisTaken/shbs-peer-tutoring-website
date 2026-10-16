// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { NotificationBell } from "./notification-bell";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  mark: vi.fn(),
  all: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      notification: {
        list: { invalidate: mocks.invalidate },
        unreadCount: { invalidate: mocks.invalidate },
      },
    }),
    notification: {
      list: { useQuery: mocks.list },
      unreadCount: { useQuery: () => ({ data: 2 }) },
      markRead: { useMutation: () => ({ mutate: mocks.mark }) },
      markAllRead: { useMutation: () => ({ mutate: mocks.all }) },
    },
  },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    onNavigate: _onNavigate,
    scroll,
    ...props
  }: React.ComponentProps<"a"> & {
    onNavigate?: unknown;
    scroll?: boolean;
  }) => (
    <a
      {...props}
      data-default-scroll={scroll === false ? "disabled" : "normal"}
    >
      {children}
    </a>
  ),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockReturnValue({
    data: [
      {
        id: "new",
        event: "tutor_application_pending",
        context: { body: "Private body" },
        title: "Old literal title",
        body: "Private old body",
        link: "/admin/applications",
        createdAt: new Date("2026-10-13T03:00:00Z"),
        readAt: null,
      },
      {
        id: "legacy",
        event: null,
        context: null,
        title: "Retained legacy notice",
        body: "Readable original notice",
        link: null,
        createdAt: new Date("2026-10-12T03:00:00Z"),
        readAt: new Date(),
      },
    ],
  });
});
afterEach(cleanup);
it.each([
  ["/admin/requests#request-survey-abc123", "disabled"],
  ["/admin/requests#request-signup-abc123", "disabled"],
  ["/admin/applications#application-abc123", "disabled"],
  ["/admin/applications", "normal"],
  ["https://external.example/admin/requests#request-survey-abc123", "normal"],
])(
  "delegates only validated record arrivals to the committed page scroller: %s",
  (link, expected) => {
    mocks.list.mockReturnValue({
      data: [
        {
          id: "record",
          event: null,
          context: null,
          title: "Exact record",
          body: null,
          link,
          createdAt: new Date(),
          readAt: null,
        },
      ],
    });
    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <NotificationBell />
      </NextIntlClientProvider>,
    );
    const target = screen.getByText("Exact record").closest("a")!;
    expect(target.getAttribute("data-default-scroll")).toBe(expected);
    expect(target.getAttribute("href")).toBe(link);
    fireEvent.click(target);
    expect(mocks.mark).toHaveBeenCalledWith({ id: "record" });
  },
);
it.each(["en", "zh"] as const)(
  "renders localized %s event copy and keeps old notices readable",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <NotificationBell />
      </NextIntlClientProvider>,
    );
    fireEvent.click(
      screen.getByLabelText(messages.components.notifications.title),
    );
    expect(
      screen.getByText(
        messages.notificationEvents.tutor_application_pending.title,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        messages.notificationEvents.tutor_application_pending.body,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Retained legacy notice")).toBeTruthy();
    expect(screen.getByText("Readable original notice")).toBeTruthy();
    expect(screen.queryByText("Private old body")).toBeNull();
    fireEvent.click(screen.getByText("Retained legacy notice"));
    expect(mocks.mark).toHaveBeenCalledWith({ id: "legacy" });
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.components.notifications.markAllRead,
      }),
    );
    expect(mocks.all).toHaveBeenCalledTimes(1);
  },
);
