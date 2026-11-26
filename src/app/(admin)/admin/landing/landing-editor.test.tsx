/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import type { Block } from "~/lib/page-blocks";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import LandingAdminPage, { LayoutEditor } from "./landing-editor";

let queryClient: QueryClient;
type LayoutPayload = {
  owner: string;
  blocks: Block[];
};
type LayoutCallbacks = { onSuccess: () => void; onSettled: () => void };
const state = vi.hoisted(() => ({
  blocks: [] as Block[],
  news: [] as Array<{
    id: string;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    pinned: boolean;
    publishedAt: Date | null;
    createdByName: string | null;
    createdAt: Date;
    updatedAt: Date;
    translations: Array<{ locale: string; title: string; body: string }>;
  }>,
  mutate: vi.fn<(payload: LayoutPayload, callbacks: LayoutCallbacks) => void>(),
  updateNews: vi.fn(),
  aboutMode: {
    useCustom: false,
    customPage: null as null | {
      id: string;
      slug: string;
      title: Record<string, string>;
      published: boolean;
      updatedAt: Date;
    },
  },
  setAboutMode: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const { translationFixtureKey } =
    await import("~/test/translation-query-bindings");
  const account = { id: "head", role: "HEAD", canTranslate: true };
  return {
    api: {
      account: {
        me: {
          _def: () => ({ path: ["account", "me"] }),
          useQuery: () =>
            useQuery({
              queryKey: translationFixtureKey("account.me"),
              queryFn: async () => account,
              initialData: account,
              staleTime: Infinity,
            }),
        },
      },
      translationIntent: {
        stop: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
      useUtils: () => ({
        home: {
          layout: { invalidate: vi.fn() },
          news: { invalidate: vi.fn() },
          pages: { invalidate: vi.fn() },
          aboutMode: { invalidate: vi.fn() },
        },
        translationIntent: { get: { fetch: vi.fn() } },
        client: { translationIntent: { get: { query: vi.fn() } } },
      }),
      i18n: {
        languages: {
          useQuery: () => ({ data: [{ code: "en", label: "English" }] }),
        },
      },
      home: {
        layout: { useQuery: () => ({ data: state.blocks, isLoading: false }) },
        setLayout: {
          useMutation: () => ({ mutate: state.mutate, isPending: false }),
        },
        images: {
          _def: () => ({ path: ["home", "images"] }),
          useQuery: () => ({ data: [], isLoading: false, isSuccess: true }),
        },
        news: { useQuery: () => ({ data: state.news, isLoading: false }) },
        createNews: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        updateNews: {
          useMutation: () => ({ mutate: state.updateNews, isPending: false }),
        },
        deleteNews: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
        setNewsTranslation: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        removeNewsTranslation: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
        pages: {
          useQuery: () => ({
            data: [],
            isLoading: false,
            isSuccess: true,
            refetch: vi.fn(),
          }),
        },
        createPage: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        reorderPages: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        aboutMode: {
          useQuery: () => ({
            data: state.aboutMode,
            isLoading: false,
            isSuccess: true,
          }),
        },
        setAboutMode: {
          useMutation: () => ({
            mutate: state.setAboutMode,
            isPending: false,
            error: null,
          }),
        },
      },
    },
  };
});
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  installSessionReadReceipts(queryClient);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  state.mutate.mockReset();
  state.updateNews.mockReset();
  state.setAboutMode.mockReset();
  state.blocks = [];
  state.news = [];
  state.aboutMode = { useCustom: false, customPage: null };
});
it("shares admission and exact dirty snapshot between both layout save actions", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LayoutEditor images={[]} readOnly={false} />
    </NextIntlClientProvider>,
  );
  const saves = () =>
    screen.getAllByRole<HTMLButtonElement>("button", {
      name: en.admin.landing.layout.save,
    });
  expect(saves().every((button) => button.disabled)).toBe(true);
  fireEvent.change(screen.getAllByRole("combobox")[1]!, {
    target: { value: "system:HERO" },
  });
  expect(saves().every((button) => !button.disabled)).toBe(true);
  fireEvent.click(saves()[0]!);
  fireEvent.click(saves()[1]!);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  const [payload, callbacks] = state.mutate.mock.calls[0]!;
  expect(payload.owner).toBe("landing");
  expect(payload.blocks).toHaveLength(1);
  // Failed writes preserve the draft and release only the admission lock.
  act(() => callbacks.onSettled());
  fireEvent.click(saves()[1]!);
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(state.mutate.mock.calls[1]![0]).toEqual(payload);
  act(() => {
    callbacks.onSuccess();
    callbacks.onSettled();
  });
  expect(saves().every((button) => button.disabled)).toBe(true);
});

it("follows untouched reads, preserves edited layout and resets ownership before late callbacks", () => {
  const tree = (owner = "landing") => (
    <NextIntlClientProvider locale="en" messages={en}>
      <LayoutEditor owner={owner} images={[]} readOnly={false} />
    </NextIntlClientProvider>
  );
  const page = render(tree());
  state.blocks = [{ id: "server-hero", type: "HERO" }];
  page.rerender(tree());
  expect(screen.getByText(en.admin.landing.layout.blockTypes.HERO)).toBeTruthy();
  fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "system:NEWS" } });
  state.blocks = [];
  page.rerender(tree());
  fireEvent.click(screen.getAllByRole("button", { name: en.admin.landing.layout.save })[0]!);
  const [payload, callbacks] = state.mutate.mock.calls[0]!;
  expect(payload.blocks.map((block) => block.type)).toEqual(["HERO", "NEWS"]);
  page.rerender(tree("page:new"));
  expect(screen.queryByText(en.admin.landing.layout.blockTypes.HERO, { selector: "span.badge-slate" })).toBeNull();
  fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "system:FEATURES" } });
  act(() => { callbacks.onSuccess(); callbacks.onSettled(); });
  fireEvent.click(screen.getAllByRole("button", { name: en.admin.landing.layout.save })[0]!);
  expect(state.mutate.mock.calls[1]![0].owner).toBe("page:new");
  expect(state.mutate.mock.calls[1]![0].blocks.map((block) => block.type)).toEqual(["FEATURES"]);
});

it.each([
  {
    timeZone: "Asia/Shanghai",
    publishedAt: new Date("2026-11-20T16:30:00.000Z"),
    expected: "2026-11-21",
  },
  {
    timeZone: "Pacific/Kiritimati",
    publishedAt: new Date("2026-11-20T10:30:00.000Z"),
    expected: "2026-11-21",
  },
  {
    timeZone: "America/Los_Angeles",
    publishedAt: new Date("2026-11-22T07:30:00.000Z"),
    expected: "2026-11-21",
  },
  {
    timeZone: "America/New_York",
    publishedAt: new Date("2026-11-22T04:30:00.000Z"),
    expected: "2026-11-21",
  },
])(
  "formats Program News publish date in the configured program time zone ($timeZone, #788)",
  ({ timeZone, publishedAt, expected }) => {
    state.news = [
      {
        id: "post-1",
        status: "PUBLISHED",
        pinned: false,
        publishedAt,
        createdByName: "Staff",
        createdAt: publishedAt,
        updatedAt: publishedAt,
        translations: [
          { locale: "en", title: "Fall Update", body: "Welcome back." },
        ],
      },
    ];
    render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" timeZone={timeZone} messages={en}>
          <LandingAdminPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.landing.tabs.news }),
    );
    const input = screen.getByLabelText<HTMLInputElement>(
      en.admin.landing.news.dateLabel,
    );
    expect(input.value).toBe(expected);
    fireEvent.change(input, { target: { value: "2026-11-25" } });
    expect(state.updateNews).toHaveBeenCalledWith({
      id: "post-1",
      publishedAt: "2026-11-25",
    });
  },
);

it("toggles between the built-in About page and a custom editor alternative in the Pages tab", () => {
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
        <LandingAdminPage initialView="pages" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  const toggle = screen.getByRole<HTMLInputElement>("checkbox", {
    name: en.admin.landing.pages.about.createAndToggleLabel,
  });
  expect(toggle.checked).toBe(false);
  expect(screen.getByText(en.admin.landing.pages.about.statusBuiltIn)).toBeTruthy();
  fireEvent.click(toggle);
  expect(state.setAboutMode).toHaveBeenCalledWith({ useCustom: true });
});
