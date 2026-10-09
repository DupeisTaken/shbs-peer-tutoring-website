// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import LandingAdminPage from "../(admin)/admin/landing/landing-editor";
import AnnouncementsPage from "../(admin)/admin/announcements/page";
import { ReadOnlyProvider } from "./read-only";

const state = vi.hoisted(() => ({
  hidden: false,
  commit: vi.fn(),
  refresh: vi.fn(),
  error: null as Error | null,
}));
const translations = [
  { locale: "en", title: "Synthetic content", body: "Example body" },
  { locale: "zh", title: "中文示例", body: "内容" },
];
const data: Record<string, unknown> = {
  layout: [],
  languages: [
    { code: "en", label: "English" },
    { code: "zh", label: "中文" },
  ],
  news: [
    {
      id: "news-1",
      translations,
      status: "PUBLISHED",
      publishedAt: null,
      pinned: false,
      createdAt: new Date(),
      createdByName: null,
    },
  ],
  sections: [
    {
      id: "section-1",
      translations,
      mode: "INLINE",
      published: true,
      openByDefault: false,
    },
  ],
  pages: [
    {
      id: "page-1",
      title: { en: "Synthetic content" },
      slug: "synthetic",
      published: true,
      showInNav: true,
    },
  ],
  images: [
    {
      id: "image-1",
      url: "/synthetic.png",
      alt: "Synthetic content",
      mimeType: "image/png",
      byteSize: 20,
      createdAt: new Date(),
      createdByName: null,
    },
  ],
  announcements: [
    {
      id: "announcement-1",
      title: "Synthetic content",
      body: "Example body",
      active: true,
      pinned: false,
      audienceRestricted: false,
      recipientTutorIds: [],
      createdAt: new Date(),
      createdBy: null,
      _count: { acks: 2 },
    },
  ],
  announcementCandidates: [],
};
vi.mock("~/trpc/react", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, scope) =>
        scope === "useUtils"
          ? () =>
              new Proxy(
                {},
                {
                  get: () =>
                    new Proxy(
                      {},
                      { get: () => ({ invalidate: state.refresh }) },
                    ),
                },
              )
          : new Proxy(
              {},
              {
                get: (_target, name) => ({
                  useQuery: () => ({
                    data:
                      state.hidden && name !== "languages" && name !== "layout"
                        ? []
                        : (data[String(name)] ?? []),
                    isLoading: false,
                    refetch: state.refresh,
                  }),
                  useMutation: () => ({
                    mutate: vi.fn(),
                    isPending: false,
                    reset: vi.fn(),
                    mutateAsync: async (input: unknown) => {
                      state.commit(String(name), input);
                      if (state.error) throw state.error;
                      return {};
                    },
                  }),
                }),
              },
            ),
    },
  ),
}));
vi.mock("./markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));
beforeEach(() => {
  state.hidden = false;
  state.error = null;
  vi.resetAllMocks();
  state.refresh.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(cleanup);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
    <ReadOnlyProvider value={false}>{children}</ReadOnlyProvider>
  </NextIntlClientProvider>
);
const cases = [
  ["news", "deleteNews", "news-1"],
  ["sections", "deleteSection", "section-1"],
  ["pages", "deletePage", "page-1"],
  ["images", "deleteImage", "image-1"],
] as const;
function selectTab(tab: (typeof cases)[number][0]) {
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs[tab] }),
  );
}
function openDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
}
it.each(cases)(
  "names %s deletion, cancels safely and retains rejection for retry",
  async (tab, operation, id) => {
    render(<LandingAdminPage />, { wrapper });
    selectTab(tab);
    openDelete();
    expect(screen.getByRole("dialog").textContent).toContain(
      "Synthetic content",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.commit).not.toHaveBeenCalled();
    state.error = new Error("Synthetic deletion rejected");
    openDelete();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Synthetic deletion rejected",
    );
    expect(state.refresh).not.toHaveBeenCalled();
    state.error = null;
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Change applied",
      ),
    );
    expect(state.commit).toHaveBeenLastCalledWith(operation, { id });
  },
);
it.each(cases)(
  "retains %s accepted-write recovery after its card disappears and Close",
  async (tab, operation, id) => {
    let reject!: (error: Error) => void;
    state.refresh.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const view = render(<LandingAdminPage />, { wrapper });
    selectTab(tab);
    openDelete();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    state.hidden = true;
    view.rerender(<LandingAdminPage />);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => reject(new Error("Read failed")));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        en.actionReview.applied,
      ),
    );
    expect(state.commit).toHaveBeenCalledExactlyOnceWith(operation, { id });
  },
);
it("removes only the named saved translation after review and reports failure", async () => {
  state.error = new Error("Translation deletion rejected");
  render(<LandingAdminPage />, { wrapper });
  selectTab("news");
  const languages = screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .find((select) =>
      Array.from(select.options).some((option) => option.value === "zh"),
    )!;
  fireEvent.change(languages, { target: { value: "zh" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.landing.translation.remove }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Synthetic content");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
  );
  await screen.findByRole("alert");
  expect(state.commit).toHaveBeenCalledExactlyOnceWith(
    "removeNewsTranslation",
    { postId: "news-1", locale: "zh" },
  );
});
it("keeps announcement deletion failures actionable and accepted read recovery outside the removed card", async () => {
  state.error = new Error("Announcement deletion rejected");
  const view = render(<AnnouncementsPage />, { wrapper });
  openDelete();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
  );
  await screen.findByRole("alert");
  state.error = null;
  state.refresh.mockRejectedValueOnce(new Error("Read failed"));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "could not be refreshed",
    ),
  );
  state.hidden = true;
  view.rerender(<AnnouncementsPage />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      en.actionReview.applied,
    ),
  );
  expect(state.commit).toHaveBeenCalledTimes(2);
});
