/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactNode } from "react";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import SlugPage from "./page";

const state = vi.hoisted(() => ({
  locale: "en",
  page: vi.fn(),
  section: vi.fn(),
  layout: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/home/pages", () => ({
  getCustomPageBySlug: state.page,
  getNavPages: async () => [],
  pageOwnerKey: (id: string) => `page:${id}`,
}));
vi.mock("~/server/home/sections", () => ({ getSectionBySlug: state.section }));
vi.mock("~/server/home/blocks", () => ({ getLayout: state.layout }));
vi.mock("~/server/home/images", () => ({
  authorizeHomeEditor: state.authorize,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async (namespace: "landing" | "common") =>
    createTranslator({
      locale: state.locale,
      messages: state.locale === "zh" ? zh : en,
      namespace,
    }),
}));
vi.mock("~/app/_components/public-header", () => ({
  PublicHeader: () => <header />,
}));
vi.mock("~/app/_components/header-menu", () => ({
  HeaderMenu: () => null,
  HeaderMenuGroup: () => null,
}));
vi.mock("~/app/_components/page-blocks", () => ({
  PageBlocks: ({ locale }: { locale: string }) => (
    <div data-testid="page-blocks" lang={locale} />
  ),
}));
vi.mock("~/app/_components/markdown", () => ({
  Markdown: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.page.mockResolvedValue(null);
  state.section.mockResolvedValue(null);
  state.layout.mockResolvedValue([]);
  state.authorize.mockResolvedValue({ ok: true, name: "Synthetic editor" });
});
afterEach(cleanup);

async function renderDetail() {
  const page = await SlugPage({
    params: Promise.resolve({ slug: "synthetic-draft" }),
  });
  // Resolve the nested async server shell explicitly; jsdom renders its resulting
  // markup, while running-site checks cover the actual RSC and new-tab lifecycle.
  if (
    !isValidElement<Record<string, unknown>>(page) ||
    typeof page.type !== "function"
  ) {
    throw new Error("Expected the detail page's server shell.");
  }
  const shell = page.type as (props: typeof page.props) => Promise<ReactNode>;
  render(await shell(page.props));
}

it.each([
  ["en", "pages"],
  ["en", "sections"],
  ["zh", "pages"],
  ["zh", "sections"],
] as const)(
  "shows the %s draft copy and return route for %s",
  async (locale, owner) => {
    state.locale = locale;
    const messages = locale === "zh" ? zh : en;
    const record = {
      id: "synthetic-page",
      title: "Synthetic draft",
      titleLocale: locale,
      body: "Section body",
      published: false,
    };
    (owner === "pages" ? state.page : state.section).mockResolvedValue(record);
    await renderDetail();
    const note =
      owner === "pages"
        ? messages.landing.detail.hiddenPageNote
        : messages.landing.detail.hiddenNote;
    const otherNote =
      owner === "pages"
        ? messages.landing.detail.hiddenNote
        : messages.landing.detail.hiddenPageNote;
    expect(screen.getByText(note, { exact: false })).toBeTruthy();
    expect(screen.queryByText(otherNote, { exact: false })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      record.title,
    );
    const back = screen.getByRole("link", {
      name: messages.landing.preview.ribbon.back,
    });
    expect(back.getAttribute("href")).toBe(`/admin/landing?view=${owner}`);
    expect(back.getAttribute("target")).toBeNull();
    expect(state.authorize).toHaveBeenCalledOnce();
    if (owner === "pages") {
      expect(state.layout).toHaveBeenCalledWith({}, "page:synthetic-page");
      expect(screen.getByTestId("page-blocks").lang).toBe(locale);
    } else {
      expect(screen.getByText("Section body")).toBeTruthy();
      expect(state.layout).not.toHaveBeenCalled();
    }
  },
);

it.each(["pages", "sections"] as const)(
  "keeps an unauthorized %s draft at 404",
  async (owner) => {
    (owner === "pages" ? state.page : state.section).mockResolvedValue({
      id: "synthetic-page",
      title: "Private draft",
      titleLocale: "en",
      body: "Private text",
      published: false,
    });
    state.authorize.mockResolvedValue({ ok: false, name: null });
    await expect(renderDetail()).rejects.toThrow("not-found");
    expect(state.layout).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Private");
  },
);

it.each(["pages", "sections"] as const)(
  "keeps published %s navigation public without an editor check",
  async (owner) => {
    (owner === "pages" ? state.page : state.section).mockResolvedValue({
      id: "synthetic-page",
      title: "Public page",
      titleLocale: "en",
      body: "Public text",
      published: true,
    });
    state.authorize.mockResolvedValue({ ok: false, name: null });
    await renderDetail();
    expect(
      screen
        .getByRole("link", { name: en.common.backToMain })
        .getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByText(en.landing.preview.draftBadge)).toBeNull();
    expect(
      screen.queryByRole("link", { name: en.landing.preview.ribbon.back }),
    ).toBeNull();
    expect(state.authorize).not.toHaveBeenCalled();
  },
);

it("keeps an unresolved slug at 404", async () => {
  await expect(renderDetail()).rejects.toThrow("not-found");
  expect(state.authorize).not.toHaveBeenCalled();
  expect(state.layout).not.toHaveBeenCalled();
});

it("redirects legacy /p/about bookmarks to the dedicated /about page", async () => {
  await expect(
    SlugPage({ params: Promise.resolve({ slug: "about" }) }),
  ).rejects.toThrow("redirect:/about");
});
