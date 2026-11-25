// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh.json";
import { AnnouncementsBanner } from "./announcements-banner";

const state = vi.hoisted(() => ({
  loading: false,
  failed: false,
  pending: false,
  error: "",
  empty: false,
  retry: vi.fn(),
  acknowledge: vi.fn(),
  announcements: [
    {
      id: "notice",
      title: "Important synthetic notice",
      body: "Read before tutoring",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      acked: false,
      pinned: false,
    },
  ],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ tutor: { myAnnouncements: { invalidate: vi.fn() } } }),
    tutor: {
      myAnnouncements: {
        useQuery: () => ({
          isLoading: state.loading,
          error: state.failed ? new Error("Offline") : null,
          refetch: state.retry,
          data: state.empty ? [] : state.announcements,
        }),
      },
      acknowledgeAnnouncement: {
        useMutation: () => ({
          mutate: state.acknowledge,
          isPending: state.pending,
          error: state.error ? new Error(state.error) : null,
        }),
      },
    },
  },
}));
const element = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "en" ? messages : zhMessages}
  >
    <AnnouncementsBanner />
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.loading = false;
  state.failed = false;
  state.pending = false;
  state.error = "";
  state.empty = false;
  state.announcements = [
    {
      id: "notice",
      title: "Important synthetic notice",
      body: "Read before tutoring",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      acked: false,
      pinned: false,
    },
  ];
});

it.each([false, true])(
  "keeps pinned announcements prominent without dismissal (acknowledged: %s)",
  (acked) => {
    state.announcements[0]!.pinned = true;
    state.announcements[0]!.acked = acked;
    const view = render(element());
    const title = screen.getByText(/📣 Important synthetic notice/);
    const card = title.closest("section > div")!;
    expect(title.textContent).toContain("📌");
    expect(title.textContent.indexOf("📌")).toBeLessThan(
      title.textContent.indexOf("📣"),
    );
    expect(card.classList.contains("bg-accent-50")).toBe(true);
    expect(card.textContent).toContain("Read before tutoring");
    expect(card.textContent).toContain("Oct 1, 2026");
    expect(
      screen.queryByRole("button", { name: messages.common.dismiss }),
    ).toBeNull();
    expect(state.acknowledge).not.toHaveBeenCalled();

    view.rerender(element("zh"));
    expect(
      screen.getByText(zhMessages.tutor.announcements.pinned).className,
    ).toBe("sr-only");
    expect(
      screen.queryByRole("button", { name: zhMessages.common.dismiss }),
    ).toBeNull();
    expect(card.textContent).toContain("2026年10月1日");
  },
);

function toggleDisclosure(summaryText: string, open: boolean) {
  const details = screen.getByText(summaryText).closest("details")!;
  details.open = open;
  fireEvent(details, new Event("toggle"));
}

it("preserves pinned-first query order and collapses acknowledged ordinary posts into a disclosure", () => {
  const ordinary = state.announcements[0]!;
  state.announcements = [
    {
      ...ordinary,
      id: "pin-old",
      title: "Earlier pinned",
      pinned: true,
      acked: true,
    },
    { ...ordinary, id: "pin-new", title: "Unread pinned", pinned: true },
    ordinary,
    {
      ...ordinary,
      id: "dismissed-new",
      title: "Dismissed ordinary newer",
      body: "Still readable when expanded",
      createdAt: new Date("2026-10-05T00:00:00Z"),
      acked: true,
    },
    {
      ...ordinary,
      id: "dismissed-old",
      title: "Dismissed ordinary older",
      body: "Older dismissed note",
      createdAt: new Date("2026-09-20T00:00:00Z"),
      acked: true,
    },
  ];
  const { container } = render(element());
  const visibleTitles = Array.from(
    container.querySelectorAll("section > div.bg-accent-50 .font-semibold"),
  );
  expect(visibleTitles.map((title) => title.textContent)).toEqual([
    expect.stringContaining("Earlier pinned"),
    expect.stringContaining("Unread pinned"),
    expect.stringContaining("Important synthetic notice"),
  ]);
  // Dismissed posts stay collapsed until opened and do not leak into the active list.
  const summaryLabel = "Dismissed Announcements (2)";
  expect(screen.getByText(summaryLabel)).toBeTruthy();
  expect(screen.queryByText(/Dismissed ordinary newer/)).toBeNull();
  expect(
    screen.getAllByRole("button", { name: messages.common.dismiss }),
  ).toHaveLength(1);

  toggleDisclosure(summaryLabel, true);
  const dismissedTitles = Array.from(
    container.querySelectorAll("details p.font-semibold"),
  );
  expect(dismissedTitles.map((title) => title.textContent)).toEqual([
    expect.stringContaining("Dismissed ordinary newer"),
    expect.stringContaining("Dismissed ordinary older"),
  ]);
  expect(screen.getByText("Still readable when expanded")).toBeTruthy();
  expect(screen.getByText("Oct 5, 2026")).toBeTruthy();
  expect(screen.getByText("Older dismissed note")).toBeTruthy();
  // Dismissed announcements do not offer another Dismiss button.
  expect(
    screen.getAllByRole("button", { name: messages.common.dismiss }),
  ).toHaveLength(1);

  toggleDisclosure(summaryLabel, false);
  expect(screen.queryByText(/Dismissed ordinary newer/)).toBeNull();

  fireEvent.click(
    screen.getByRole("button", { name: messages.common.dismiss }),
  );
  expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith({
    announcementId: "notice",
  });
});

it("moves an ordinary post into the collapsed menu after acknowledgement and restores it when pinned", () => {
  const view = render(element());
  expect(
    screen.getByRole("button", { name: messages.common.dismiss }),
  ).toBeTruthy();
  expect(screen.queryByText(/Dismissed Announcements/)).toBeNull();

  // After acknowledgement, the post moves into the collapsed dismissed menu.
  state.announcements[0]!.acked = true;
  view.rerender(element());
  expect(screen.queryByText(/Important synthetic notice/)).toBeNull();
  expect(screen.getByText("Dismissed Announcements (1)")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.common.dismiss }),
  ).toBeNull();

  // Expanding reveals the dismissed post in EN and ZH without a Dismiss button.
  toggleDisclosure("Dismissed Announcements (1)", true);
  expect(screen.getByText(/📣 Important synthetic notice/)).toBeTruthy();
  expect(screen.getByText("Read before tutoring")).toBeTruthy();
  view.rerender(element("zh"));
  expect(screen.getByText("已关闭的公告（1）")).toBeTruthy();
  expect(screen.getByText("2026年10月1日")).toBeTruthy();

  // Pinning moves the post back to the prominent area and removes the empty menu.
  state.announcements[0]!.pinned = true;
  view.rerender(element());
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  expect(screen.queryByText(/Dismissed Announcements/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: messages.common.dismiss }),
  ).toBeNull();

  // Unpinning returns the acknowledged post to the collapsed menu (collapsed by default).
  state.announcements[0]!.pinned = false;
  view.rerender(element());
  expect(screen.getByText("Dismissed Announcements (1)")).toBeTruthy();
  expect(screen.queryByText(/Important synthetic notice/)).toBeNull();
});

it("retains cached announcements beside read recovery and shows failed acknowledgements", () => {
  state.failed = true;
  const view = render(element());
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.tasks.retry }),
  );
  expect(state.retry).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: messages.common.dismiss }),
  );
  expect(state.acknowledge).toHaveBeenCalledWith({ announcementId: "notice" });
  state.failed = false;
  state.error = "Acknowledgement failed";
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe(
    messages.errorRecovery.generic,
  );
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  state.pending = true;
  view.rerender(element());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.common.dismiss,
    }).disabled,
  ).toBe(true);
});
it("retains cached dismissed announcements beside read recovery when all posts are dismissed", () => {
  state.announcements[0]!.acked = true;
  state.failed = true;
  render(element());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText("Dismissed Announcements (1)")).toBeTruthy();
  toggleDisclosure("Dismissed Announcements (1)", true);
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.tasks.retry }),
  );
  expect(state.retry).toHaveBeenCalledOnce();
});

it("distinguishes empty success from loading or a failed initial read", () => {
  state.empty = true;
  const view = render(element());
  expect(view.container.textContent).toBe("");
  state.loading = true;
  view.rerender(element());
  expect(screen.getByRole("status").textContent).toContain("Loading");
  state.loading = false;
  state.failed = true;
  view.rerender(element());
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: messages.tutor.tasks.retry }),
  ).toBeTruthy();
});
