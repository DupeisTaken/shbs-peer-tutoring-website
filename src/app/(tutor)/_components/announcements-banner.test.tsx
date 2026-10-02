// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { AnnouncementsBanner } from "./announcements-banner";

const state = vi.hoisted(() => ({
  loading: false,
  failed: false,
  pending: false,
  error: "",
  empty: false,
  retry: vi.fn(),
  acknowledge: vi.fn(),
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
          data: state.empty
            ? []
            : [
                {
                  id: "notice",
                  title: "Important synthetic notice",
                  body: "Read before tutoring",
                  createdAt: new Date("2026-10-01T00:00:00Z"),
                  acked: false,
                  pinned: true,
                },
              ],
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
const element = () => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
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
