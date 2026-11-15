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

it("preserves pinned-first query order and hides acknowledged ordinary posts", () => {
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
    { ...ordinary, id: "dismissed", title: "Dismissed ordinary", acked: true },
  ];
  const { container } = render(element());
  const titles = Array.from(container.querySelectorAll(".font-semibold"));
  expect(titles.map((title) => title.textContent)).toEqual([
    expect.stringContaining("Earlier pinned"),
    expect.stringContaining("Unread pinned"),
    expect.stringContaining("Important synthetic notice"),
  ]);
  expect(screen.queryByText(/Dismissed ordinary/)).toBeNull();
  expect(
    screen.getAllByRole("button", { name: messages.common.dismiss }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: messages.common.dismiss }),
  );
  expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith({
    announcementId: "notice",
  });
});

it("hides an ordinary post after acknowledgement and restores it when pinned", () => {
  const view = render(element());
  expect(
    screen.getByRole("button", { name: messages.common.dismiss }),
  ).toBeTruthy();
  state.announcements[0]!.acked = true;
  view.rerender(element());
  expect(view.container.textContent).toBe("");
  state.announcements[0]!.pinned = true;
  view.rerender(element());
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.common.dismiss }),
  ).toBeNull();
  state.announcements[0]!.pinned = false;
  view.rerender(element());
  expect(view.container.textContent).toBe("");
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
  expect(screen.getByRole("alert").textContent).toBe(state.error);
  expect(screen.getByText(/Important synthetic notice/)).toBeTruthy();
  state.pending = true;
  view.rerender(element());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.common.dismiss,
    }).disabled,
  ).toBe(true);
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
