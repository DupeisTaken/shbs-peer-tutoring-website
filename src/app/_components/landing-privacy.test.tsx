// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { LandingView } from "./landing-view";

const mocks = vi.hoisted(() => ({
  locale: "en",
  timeZone: "Asia/Shanghai",
  features: { VIEWER_SIGNUP: false },
  blocks: [] as { id: string; type: "HERO" | "NEWS" }[],
  news: [] as {
    id: string;
    title: string;
    body: string;
    date: string | null;
    published: boolean;
  }[],
  navPages: [] as { slug: string; label: string; labelLocale: string }[],
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => mocks.locale,
  getTimeZone: async () => mocks.timeZone,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => mocks.features,
}));
vi.mock("~/server/home/content", () => ({
  getHomeOverrides: async () => ({}),
  applyHomeVars: (text: string) => text,
}));
vi.mock("~/server/home/news", () => ({
  getLandingNews: async () => mocks.news,
}));
vi.mock("~/server/home/sections", () => ({
  getLandingSections: async () => [],
}));
vi.mock("~/server/home/blocks", () => ({
  getLandingLayout: async () => mocks.blocks,
}));
vi.mock("~/server/home/pages", () => ({
  getNavPages: async () => mocks.navPages,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("~/app/_components/landing-sections", () => ({
  LandingSections: () => null,
}));
vi.mock("~/app/_components/page-blocks", () => ({
  RichTextBlock: () => null,
  ImageBlock: () => null,
  ButtonsBlock: () => null,
  ColumnsBlock: () => null,
}));
afterEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.timeZone = "Asia/Shanghai";
  mocks.features = { VIEWER_SIGNUP: false };
  mocks.blocks = [];
  mocks.news = [];
  mocks.navPages = [];
});

it("carries each custom page label's language into the unified landing menu", async () => {
  mocks.locale = "zh";
  mocks.navPages = [
    {
      slug: "synthetic-english",
      label: "English navigation",
      labelLocale: "en",
    },
    { slug: "synthetic-chinese", label: "中文导航", labelLocale: "zh" },
  ];
  render(<div lang="zh">{await LandingView({})}</div>);
  const name = "nav.signInAndJoin";
  const trigger = screen.getByRole("button", { name });
  expect(trigger.closest("[lang]")?.getAttribute("lang")).toBe("zh");
  fireEvent.click(trigger);
  const menu = within(screen.getByRole("dialog", { name }));
  const english = menu.getByRole("link", { name: "English navigation" });
  expect(english.lang).toBe("en");
  expect(english.getAttribute("href")).toBe("/p/synthetic-english");
  expect(menu.getByRole("link", { name: "中文导航" }).lang).toBe("zh");
});

it.each([
  ["en", "About the Program", "Privacy policy"],
  ["zh", "关于项目", "隐私政策"],
  ["fr", "About the Program", "Privacy policy"],
])(
  "keeps the %s about and privacy links when landing content is empty without duplicating an about custom page",
  async (locale, aboutLabel, privacyLabel) => {
    mocks.locale = locale!;
    mocks.navPages = [
      { slug: "about", label: "Duplicate seed about", labelLocale: "en" },
    ];
    render(await LandingView({}));
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: aboutLabel }).getAttribute("href")).toBe(
      "/about",
    );
    expect(
      footer.getByRole("link", { name: privacyLabel }).getAttribute("href"),
    ).toBe("/privacy");
    const menu = "nav.signInAndJoin";
    fireEvent.click(screen.getByRole("button", { name: menu }));
    const dialog = within(screen.getByRole("dialog", { name: menu }));
    expect(dialog.getByRole("link", { name: aboutLabel }).getAttribute("href")).toBe(
      "/about",
    );
    expect(
      dialog.getByRole("link", { name: privacyLabel }).getAttribute("href"),
    ).toBe("/privacy");
    expect(dialog.queryByRole("link", { name: "Duplicate seed about" })).toBeNull();
  },
);

it.each([0, 1, 2])(
  "keeps one page H1 with %s configured hero blocks",
  async (count) => {
    mocks.blocks = Array.from({ length: count }, (_, index) => ({
      id: `hero-${index}`,
      type: "HERO",
    }));
    render(await LandingView({}));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
);

it.each([
  {
    timeZone: "Asia/Shanghai",
    date: "2026-11-20T16:30:00.000Z",
    expected: "Nov 21, 2026",
  },
  {
    timeZone: "America/Los_Angeles",
    date: "2026-11-22T07:30:00.000Z",
    expected: "Nov 21, 2026",
  },
])(
  "formats public Program News dates in the configured program timezone ($timeZone, #788)",
  async ({ timeZone, date, expected }) => {
    mocks.locale = "en";
    mocks.timeZone = timeZone;
    mocks.blocks = [{ id: "news-1", type: "NEWS" }];
    mocks.news = [
      {
        id: "post-1",
        title: "Fall Update",
        body: "Welcome back.",
        date,
        published: true,
      },
    ];
    render(await LandingView({}));
    expect(screen.getByText(expected)).toBeTruthy();
  },
);

it("replaces hero CTA links for signed-in roles on Program Home but leaves preview unchanged", async () => {
  mocks.blocks = [{ id: "hero-1", type: "HERO" }];
  const signedInLinks = {
    byPath: {
      "/tutee": { href: "/student", label: "Enter Tutee Page" },
      "/tutor": { href: "/dashboard", label: "Enter Tutor Page" },
    },
  };
  const { unmount } = render(
    await LandingView({
      signedInHeader: <header data-header="workspace" />,
      signedInLinks,
    }),
  );
  expect(
    screen.getByRole("link", { name: "Enter Tutee Page" }).getAttribute("href"),
  ).toBe("/student");
  expect(
    screen.getByRole("link", { name: "Enter Tutor Page" }).getAttribute("href"),
  ).toBe("/dashboard");
  unmount();

  render(await LandingView({ preview: true, signedInLinks }));
  expect(
    screen.getByRole("link", { name: "ctaPrimary" }).getAttribute("href"),
  ).toBe("/tutee");
  expect(
    screen.getByRole("link", { name: "ctaSecondary" }).getAttribute("href"),
  ).toBe("/tutor");
});

it("includes the viewer role background description under Follow the Program when viewer signup is enabled", async () => {
  mocks.features = { VIEWER_SIGNUP: true };
  render(await LandingView({}));
  const menuName = "nav.signInAndJoin";
  fireEvent.click(screen.getByRole("button", { name: menuName }));
  const menu = within(screen.getByRole("dialog", { name: menuName }));
  const link = menu.getByRole("link", { name: /nav\.viewerSignup/ });
  expect(link.getAttribute("href")).toBe("/viewer");
  expect(link.textContent).toContain("viewerSignupHelp");
});
