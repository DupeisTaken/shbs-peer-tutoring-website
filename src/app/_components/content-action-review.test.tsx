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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  fieldError: null as null | { message: string },
  pending: false,
  write: vi.fn(),
  coldReads: false,
  readError: ((): Record<
    string,
    { message: string; data?: { code: string } } | undefined
  > => ({}))(),
}));
const translations = [
  { locale: "en", title: "Synthetic content", body: "Example body" },
  { locale: "zh", title: "中文示例", body: "内容" },
];
const data: Record<string, unknown> = {
  layout: [],
  content: [
    {
      key: "tagline",
      kind: "line",
      default: "Saved tagline",
      override: null,
      global: false,
      hasAppTitle: false,
    },
  ],
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
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (procedure: { name: string }) => [procedure.name],
}));
let queryClient: QueryClient;
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
                  name: String(name),
                  useQuery: () => ({
                    data:
                      state.coldReads &&
                      (name === "announcements" ||
                        name === "announcementCandidates")
                        ? undefined
                        : state.hidden &&
                            name !== "languages" &&
                            name !== "layout"
                          ? []
                          : (data[String(name)] ?? []),
                    error: state.readError[String(name)],
                    isError: !!state.readError[String(name)],
                    isSuccess:
                      !state.readError[String(name)] && !state.coldReads,
                    isFetching: false,
                    isLoading: false,
                    refetch: state.refresh,
                  }),
                  useMutation: () => ({
                    mutate: state.write,
                    isPending: state.pending,
                    error: state.fieldError,
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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.readError = {};
  state.coldReads = false;
  state.hidden = false;
  state.error = null;
  state.fieldError = null;
  state.pending = false;
  data.layout = [];
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
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <ReadOnlyProvider value={false}>{children}</ReadOnlyProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);
const cases = [
  ["news", "deleteNews", "news-1"],
  ["sections", "deleteSection", "section-1"],
  ["pages", "deletePage", "page-1"],
  ["images", "deleteImage", "image-1"],
] as const;

it("retains independent fixed-content drafts across locales, tabs, errors and pending writes", () => {
  const view = render(<LandingAdminPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  const tagline = () =>
    screen.getByRole<HTMLInputElement>("textbox", {
      name: en.admin.landing.fields.tagline,
    });
  fireEvent.change(tagline(), { target: { value: "English local draft" } });
  const language = screen.getByRole("combobox", { name: en.common.language });
  fireEvent.change(language, { target: { value: "zh" } });
  fireEvent.change(tagline(), { target: { value: "中文本地草稿" } });
  state.fieldError = { message: "Synthetic save failed" };
  view.rerender(<LandingAdminPage />);
  fireEvent.change(language, { target: { value: "en" } });
  expect(tagline().value).toBe("English local draft");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.layout }),
  );
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  expect(tagline().value).toBe("English local draft");
  state.pending = true;
  view.rerender(<LandingAdminPage />);
  expect(tagline().disabled).toBe(true);
  fireEvent.change(language, { target: { value: "zh" } });
  expect(tagline().value).toBe("中文本地草稿");
  expect(state.write).not.toHaveBeenCalled();
});

it("retains a custom-page layout draft through collapse and top-level tab changes", () => {
  data.layout = [
    { id: "text", type: "RICH_TEXT", text: { en: "Saved page body" } },
  ];
  render(<LandingAdminPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.pages }),
  );
  const disclosure = screen.getByRole("button", {
    name: en.admin.landing.pages.editContent,
  });
  fireEvent.click(disclosure);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Content (Markdown)" }),
    { target: { value: "Unsaved custom page body" } },
  );
  fireEvent.click(disclosure);
  fireEvent.click(disclosure);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Content (Markdown)",
    }).value,
  ).toBe("Unsaved custom page body");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.content }),
  );
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.pages }),
  );
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Content (Markdown)",
    }).value,
  ).toBe("Unsaved custom page body");
  expect(state.write).not.toHaveBeenCalled();
});
it("retains independent news translations and a custom-page title after background data changes", () => {
  const view = render(<LandingAdminPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.news }),
  );
  const title = () =>
    screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });
  fireEvent.change(title(), { target: { value: "English news draft" } });
  const language = screen.getByRole("combobox", {
    name: en.admin.landing.translation.language,
  });
  fireEvent.change(language, { target: { value: "zh" } });
  fireEvent.change(title(), { target: { value: "中文新闻草稿" } });
  fireEvent.change(language, { target: { value: "en" } });
  expect(title().value).toBe("English news draft");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.pages }),
  );
  const pageTitle = screen.getByRole<HTMLInputElement>("textbox", {
    name: en.admin.landing.pages.titleLabel,
  });
  fireEvent.change(pageTitle, { target: { value: "Local page title" } });
  view.rerender(<LandingAdminPage />);
  expect(pageTitle.value).toBe("Local page title");
  fireEvent.change(screen.getByRole("combobox", { name: en.common.language }), {
    target: { value: "zh" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: en.common.language }), {
    target: { value: "en" },
  });
  expect(pageTitle.value).toBe("Local page title");
});
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

it("shows scoped announcement/candidate failures without false empty states", () => {
  state.coldReads = true;
  state.readError = {
    announcements: { message: "Offline" },
    announcementCandidates: { message: "Offline" },
  };
  render(<AnnouncementsPage />, { wrapper });
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.queryByText(en.admin.announcements.empty)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry Announcements" }));
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("retains labelled announcement drafts through transient read failure but conceals revoked records", () => {
  const rendered = render(<AnnouncementsPage />, { wrapper });
  const fields = screen.getAllByLabelText<HTMLInputElement>(
    en.admin.announcements.new.titlePlaceholder,
  );
  fireEvent.change(fields[0]!, { target: { value: "Creation draft" } });
  state.readError.announcementCandidates = { message: "Offline" };
  rendered.rerender(<AnnouncementsPage />);
  expect(fields[0]!.value).toBe("Creation draft");
  expect(
    screen.getAllByLabelText(en.admin.announcements.messageLabel).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.admin.announcements.new.broadcast,
    }).disabled,
  ).toBe(true);
  queryClient.setQueryData(["announcements"], data.announcements);
  state.readError.announcements = {
    message: "Denied",
    data: { code: "FORBIDDEN" },
  };
  rendered.rerender(<AnnouncementsPage />);
  expect(screen.queryByDisplayValue("Synthetic content")).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: en.admin.announcements.new.broadcast,
    }),
  ).toBeNull();
  expect(screen.queryByDisplayValue("Creation draft")).toBeNull();
  expect(queryClient.getQueryData(["announcements"])).toBeUndefined();
  state.readError.announcements = { message: "Offline" };
  rendered.rerender(<AnnouncementsPage />);
  expect(screen.queryByDisplayValue("Synthetic content")).toBeNull();
  state.readError = {};
  rendered.rerender(<AnnouncementsPage />);
  expect(screen.getByDisplayValue("Synthetic content")).toBeTruthy();
  expect(screen.getByDisplayValue("Creation draft")).toBeTruthy();
});
