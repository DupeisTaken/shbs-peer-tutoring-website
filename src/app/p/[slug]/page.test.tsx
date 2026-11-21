// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Block } from "~/lib/page-blocks";
import SlugPage from "./page";

const mocks = vi.hoisted(() => ({
  page: null as {
    id: string;
    title: Record<string, string>;
    published: boolean;
  } | null,
  section: null as { title: string; body: string; published: boolean } | null,
  getLayout: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "zh",
  getTranslations: async () => (key: string) => {
    const labels: Record<string, string> = {
      "nav.accessProgramInformation": "项目信息",
      "nav.menu": "菜单",
      "preview.draftBadge": "草稿",
      "detail.hiddenNote": "访客不可见",
      "preview.ribbon.back": "返回编辑",
      backToMain: "返回主页",
    };
    return labels[key] ?? key;
  },
}));
vi.mock("~/server/db", () => ({
  db: {
    customPage: {
      findUnique: async () => mocks.page,
      findMany: async () => [
        { slug: "english", title: { en: "English navigation" } },
        { slug: "chinese", title: { zh: "中文导航" } },
      ],
    },
  },
}));
vi.mock("~/server/home/sections", () => ({
  getSectionBySlug: async () => mocks.section,
}));
vi.mock("~/server/home/blocks", () => ({ getLayout: mocks.getLayout }));
vi.mock("~/server/home/images", () => ({
  authorizeHomeEditor: mocks.authorize,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));

// Resolve the route's async shell explicitly; native verification covers the RSC boundary.
async function renderRoute() {
  const route = (await SlugPage({
    params: Promise.resolve({ slug: "synthetic-page" }),
  })) as ReactElement<Record<string, unknown>>;
  const renderShell = route.type as (
    props: Record<string, unknown>,
  ) => Promise<ReactNode>;
  return render(<div lang="zh">{await renderShell(route.props)}</div>);
}

beforeEach(() => {
  mocks.page = {
    id: "synthetic",
    title: { en: "English title" },
    published: true,
  };
  mocks.section = null;
  mocks.getLayout
    .mockReset()
    .mockResolvedValue([
      { id: "synthetic-body", type: "RICH_TEXT", text: { zh: "中文正文" } },
    ] satisfies Block[]);
  mocks.authorize.mockReset().mockResolvedValue({ ok: false });
});
afterEach(cleanup);

it("keeps title, body, each menu label and Chinese chrome independently marked", async () => {
  await renderRoute();
  expect(screen.getByRole("heading", { level: 1 }).lang).toBe("en");
  expect(
    screen.getByText("中文正文").closest("[lang]")?.getAttribute("lang"),
  ).toBe("zh");
  const back = screen.getByRole("link", { name: "返回主页" });
  expect(back.getAttribute("href")).toBe("/");
  expect(back.closest("[lang]")?.getAttribute("lang")).toBe("zh");
  expect(document.querySelector("main")?.hasAttribute("lang")).toBe(false);
  for (const name of ["菜单", "项目信息"]) {
    fireEvent.click(screen.getByRole("button", { name }));
    const menu = within(screen.getByRole("dialog", { name }));
    const english = menu.getByRole("link", { name: "English navigation" });
    expect(english.lang).toBe("en");
    expect(english.getAttribute("href")).toBe("/p/english");
    expect(menu.getByRole("link", { name: "中文导航" }).lang).toBe("zh");
  }
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.getLayout).toHaveBeenCalledWith(
    expect.anything(),
    "page:synthetic",
  );
});

it("does not use the translated title's language for an English body", async () => {
  mocks.page!.title.zh = "中文标题";
  mocks.getLayout.mockResolvedValue([
    { id: "english-body", type: "RICH_TEXT", text: { en: "English body" } },
  ] satisfies Block[]);
  await renderRoute();
  expect(screen.getByRole("heading", { level: 1 }).lang).toBe("zh");
  expect(
    screen.getByText("English body").closest("[lang]")?.getAttribute("lang"),
  ).toBe("en");
});

it("keeps editor-only draft preview and its Chinese return link", async () => {
  mocks.page!.published = false;
  mocks.authorize.mockResolvedValue({ ok: true });
  await renderRoute();
  expect(screen.getByText("草稿").closest("[lang]")?.getAttribute("lang")).toBe(
    "zh",
  );
  const back = screen.getByRole("link", { name: "返回编辑" });
  expect(back.getAttribute("href")).toBe("/admin/landing");
  expect(back.closest("[lang]")?.getAttribute("lang")).toBe("zh");
  expect(screen.getByRole("heading", { level: 1 }).lang).toBe("en");
});

it("does not expose unpublished content to visitors", async () => {
  mocks.page!.published = false;
  await expect(renderRoute()).rejects.toThrow("not-found");
  expect(mocks.getLayout).not.toHaveBeenCalled();
});

it("retains section resolution and unknown-page behavior", async () => {
  mocks.page = null;
  mocks.section = { title: "中文信息", body: "中文段落", published: true };
  await renderRoute();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "中文信息",
  );
  expect(screen.getByText("中文段落")).toBeTruthy();
  mocks.section = null;
  await expect(renderRoute()).rejects.toThrow("not-found");
});
