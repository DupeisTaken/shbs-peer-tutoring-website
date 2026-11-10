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
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import { translationFixtureKey } from "~/test/translation-query-bindings";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import LandingAdminPage from "../(admin)/admin/landing/landing-editor";
import AnnouncementsPage from "../(admin)/admin/announcements/page";
import { ReadOnlyProvider } from "./read-only";
import { createTranslationIntentClient } from "~/lib/translation-intent-client";
import type * as IntentClientModule from "~/lib/translation-intent-client";
import {
  translationBusinessInputs,
  translationIntentEnvelope,
} from "~/lib/translation-intent";

const state = vi.hoisted(() => ({
  hidden: false,
  commit: vi.fn<(operation: string, input: unknown) => void>(),
  refresh: vi.fn(),
  error: null as Error | null,
  fieldError: null as null | { message: string },
  pending: false,
  textGate: null as Promise<void> | null,
  readFailure: null as Error | null,
  read: vi.fn<(name: string, input?: unknown) => void>(),
  intentClient: undefined as
    IntentClientModule.TranslationIntentClient | undefined,
  write: vi.fn(),
  coldReads: false,
  readError: ((): Record<
    string,
    { message: string; data?: { code: string } } | undefined
  > => ({}))(),
}));
vi.mock("~/lib/translation-intent-client", async (original) => {
  const actual = await original<typeof IntentClientModule>();
  return {
    ...actual,
    get translationIntentClient() {
      return state.intentClient!;
    },
  };
});
const translations = [
  { locale: "en", title: "Synthetic content", body: "Example body" },
  { locale: "zh", title: "中文示例", body: "内容" },
];
const data: Record<string, unknown> = {
  me: { id: "landing-review-admin", role: "ADMIN", canTranslate: true },
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
let queryClient: QueryClient;
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  function useAccountQuery() {
    return useQuery({
      queryKey: translationFixtureKey("account.me"),
      queryFn: async () => data.me,
      initialData: data.me,
      staleTime: Infinity,
    });
  }
  return {
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
                        {
                          get: (_target, name) => ({
                            invalidate: state.refresh,
                            fetch: async (input?: unknown) => {
                              state.read(String(name), input);
                              if (state.readFailure) throw state.readFailure;
                              return data[String(name)] ?? [];
                            },
                          }),
                        },
                      ),
                  },
                )
            : new Proxy(
                {},
                {
                  get: (_target, name) => ({
                    name: String(name),
                    _def: () => ({ path: [String(scope), String(name)] }),
                    useQuery:
                      name === "me"
                        ? useAccountQuery
                        : () => ({
                            data:
                              name === "me"
                                ? data.me
                                : state.coldReads &&
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
                              !state.readError[String(name)] &&
                              !state.coldReads,
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
                        if (scope === "home" && name === "setContent") {
                          if (state.textGate) await state.textGate;
                          const captured = translationBusinessInputs[
                            "home.setContent"
                          ]
                            .extend({ intent: translationIntentEnvelope })
                            .parse(input);
                          return {
                            ok: true,
                            receipt: {
                              status: "ACCEPTED",
                              version: 1,
                              intentId: captured.intent.id,
                              operation: "home.setContent",
                              mode: captured.intent.mode,
                              outcome:
                                captured.intent.mode === "DRAFT"
                                  ? "DRAFT_SUBMITTED"
                                  : "PUBLISHED",
                              acceptedAt: new Date("2026-11-09"),
                              draftId:
                                captured.intent.mode === "DRAFT"
                                  ? "synthetic-draft"
                                  : null,
                              cleared: false,
                              replayed: false,
                            },
                          };
                        }
                        return {};
                      },
                    }),
                  }),
                },
              ),
      },
    ),
  };
});
vi.mock("./markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  installSessionReadReceipts(queryClient);
  sessionStorage.clear();
  state.intentClient = createTranslationIntentClient(() => sessionStorage);
  state.readError = {};
  state.coldReads = false;
  state.hidden = false;
  state.error = null;
  state.fieldError = null;
  state.pending = false;
  state.textGate = null;
  state.readFailure = null;
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
afterEach(() => {
  cleanup();
  queryClient.clear();
});
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

it("puts custom-page navigation before boxed actions and Delete last without writing", () => {
  render(<LandingAdminPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.landing.tabs.pages }),
  );
  const link = screen.getByRole("link", {
    name: `${en.admin.landing.sections.viewPage} ↗`,
  });
  const actions = link.parentElement!;
  expect(
    [...actions.querySelectorAll("a, button")].map((action) =>
      action.textContent?.trim(),
    ),
  ).toEqual([
    `${en.admin.landing.sections.viewPage} ↗`,
    "↑",
    "↓",
    en.admin.landing.sections.actions.hide,
    en.common.delete,
  ]);
  expect(link.getAttribute("href")).toBe("/p/synthetic");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(state.write).not.toHaveBeenCalled();
});

it("retains independent fixed-content drafts across locales, tabs, errors and pending writes", async () => {
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
  state.fieldError = null;
  let finish!: () => void;
  state.textGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  view.rerender(<LandingAdminPage />);
  fireEvent.click(screen.getByRole("button", { name: en.common.save }));
  await waitFor(() => expect(state.commit).toHaveBeenCalledTimes(1));
  const submitted = state.commit.mock.calls[0]![1];
  const captured = translationBusinessInputs["home.setContent"]
    .extend({ intent: translationIntentEnvelope })
    .parse(submitted);
  const uuid: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/);
  expect(state.commit.mock.calls[0]![0]).toBe("setContent");
  expect(captured).toEqual({
    locale: "en",
    key: "tagline",
    value: "English local draft",
    intent: {
      version: 1,
      id: uuid,
      actorId: "landing-review-admin",
      mode: "PUBLISH",
    },
  });
  expect(Object.isFrozen(submitted)).toBe(true);
  if (!submitted || typeof submitted !== "object" || !("intent" in submitted))
    throw new Error("The raw request did not retain its captured intent");
  expect(Object.isFrozen(submitted.intent)).toBe(true);
  const original = JSON.stringify(submitted);
  expect(tagline().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.common.save }));
  fireEvent.change(language, { target: { value: "zh" } });
  expect(tagline().value).toBe("中文本地草稿");
  expect(tagline().disabled).toBe(true);
  expect(JSON.stringify(submitted)).toBe(original);
  expect(state.commit).toHaveBeenCalledTimes(1);
  fireEvent.change(language, { target: { value: "en" } });
  expect(tagline().value).toBe("English local draft");

  state.readFailure = new Error("Synthetic accepted content read unavailable");
  await act(async () => {
    finish();
  });
  const retry = await screen.findByRole<HTMLButtonElement>("button", {
    name: en.translationIntent.refreshAccepted,
  });
  await waitFor(() => expect(retry.disabled).toBe(false));
  expect(tagline().disabled).toBe(true);
  expect(state.read).toHaveBeenCalledExactlyOnceWith("content", {
    locale: "en",
  });
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.readFailure = null;
  await act(async () => {
    fireEvent.click(retry);
  });
  await waitFor(() => expect(tagline().disabled).toBe(false));
  expect(tagline().value).toBe("English local draft");
  fireEvent.change(language, { target: { value: "zh" } });
  expect(tagline().value).toBe("中文本地草稿");
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(
    state.read.mock.calls.every(
      ([name, input]) =>
        name === "content" &&
        !!input &&
        typeof input === "object" &&
        "locale" in input &&
        input.locale === "en",
    ),
  ).toBe(true);
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(state.commit).toHaveBeenCalledTimes(1);
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
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.announcements.create }),
  );
  // Modal isolates candidate failure; the retained list failure remains outside its inert background.
  expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText(en.admin.announcements.empty)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry Announcements" }));
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("retains labelled announcement drafts through transient read failure but conceals revoked records", () => {
  const rendered = render(<AnnouncementsPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.announcements.create }),
  );
  const fields = within(
    screen.getByRole("dialog"),
  ).getAllByLabelText<HTMLInputElement>(
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
  queryClient.setQueryData(
    translationFixtureKey("admin.announcements"),
    data.announcements,
  );
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
  expect(
    queryClient.getQueryData(translationFixtureKey("admin.announcements")),
  ).toBeUndefined();
  state.readError.announcements = { message: "Offline" };
  rendered.rerender(<AnnouncementsPage />);
  expect(screen.queryByDisplayValue("Synthetic content")).toBeNull();
  state.readError = {};
  rendered.rerender(<AnnouncementsPage />);
  expect(screen.getByDisplayValue("Synthetic content")).toBeTruthy();
  expect(screen.getByDisplayValue("Creation draft")).toBeTruthy();
});
