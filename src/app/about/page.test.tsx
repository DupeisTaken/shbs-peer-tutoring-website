// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import AboutPage, { generateMetadata } from "./page";
import { buildStarterAboutBlocks, getAboutContent } from "~/lib/about-content";
import { layoutSchema, type Block } from "~/lib/page-blocks";

const mocks = vi.hoisted(() => ({
  locale: "en",
  supportEmail: "",
  headEmail: null as string | null,
  stats: { totalSessions: 128, totalMinutesTutored: 5760 },
  features: { CREW: true, VIEWER_SIGNUP: true },
  custom: null as {
    title: string;
    titleLocale: string | undefined;
    blocks: Block[];
    isPreview: boolean;
  } | null,
  authorize: { ok: false },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => mocks.features,
}));
vi.mock("~/server/home/about", () => ({
  getAboutLiveStats: async () => mocks.stats,
  getCurrentHeadEmail: async () => mocks.headEmail,
  getCustomAboutRender: async (
    _db: unknown,
    _locale: string,
    opts: { allowPreview: boolean },
  ) => {
    if (!mocks.custom) return null;
    if (mocks.custom.isPreview && !opts.allowPreview) return null;
    return mocks.custom;
  },
}));
vi.mock("~/server/home/images", () => ({
  authorizeHomeEditor: async () => mocks.authorize,
}));
vi.mock("~/lib/branding", () => ({
  APP_TITLE: "SHBS Peer Tutoring",
  ORG_NAME: "SHBS Peer Tutoring",
  get SUPPORT_EMAIL() {
    return mocks.supportEmail;
  },
}));
vi.mock("~/app/_components/signed-in-workspace-header", () => ({
  getSignedInWorkspaceHeader: async () => null,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => <select aria-label="Language" />,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => <button>Theme</button>,
}));
vi.mock("~/app/_components/page-blocks", () => ({
  PageBlocks: ({ blocks, locale }: { blocks: Block[]; locale: string }) => (
    <div
      data-testid="custom-about-blocks"
      data-count={blocks.length}
      lang={locale}
    />
  ),
}));

afterEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.supportEmail = "";
  mocks.headEmail = null;
  mocks.stats = { totalSessions: 128, totalMinutesTutored: 5760 };
  mocks.features = { CREW: true, VIEWER_SIGNUP: true };
  mocks.custom = null;
  mocks.authorize = { ok: false };
});

it.each(["en", "zh", "fr", "custom"])(
  "renders the dedicated bilingual About page with aligned anchors and single full school name for %s",
  async (locale) => {
    mocks.locale = locale;
    mocks.headEmail = "head@shbs.example";
    const content = getAboutContent(locale);
    render(await AboutPage());

    const article = screen.getByRole("article", { name: content.title });
    expect(article.lang).toBe(locale === "zh" ? "zh" : "en");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      content.title,
    );

    // Every in-page TOC link resolves to a section containing the heading.
    for (const link of within(
      screen.getByRole("navigation", { name: content.contentsLabel }),
    ).getAllByRole("link")) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id)?.textContent).toContain(
        link.textContent,
      );
    }

    // Spell out the full school name only once across the rendered article.
    const fullName =
      locale === "zh"
        ? "上海青浦区宏润博源高级中学"
        : "Shanghai Hongrun Boyuan School";
    const matches = (article.textContent ?? "").match(
      new RegExp(fullName, "g"),
    );
    expect(matches).toHaveLength(1);

    // Counting-only live stats (total sessions held + total minutes tutored).
    expect(screen.getByTestId("about-stat-sessions").textContent).toBe("128");
    expect(screen.getByTestId("about-stat-minutes").textContent).toBe("5,760");

    // Header uses the Program Information / About location title without a redundant Back to Main Page link.
    expect(
      screen.getByRole("link", { name: content.headerTitle }).getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByRole("link", { name: "backToMain" })).toBeNull();

    // Current Head login email attached to the Management Team card.
    expect(
      screen.getByRole("link", { name: "head@shbs.example" }).getAttribute("href"),
    ).toBe("mailto:head@shbs.example");

    expect(await generateMetadata()).toMatchObject({
      title: `${content.headerTitle} | SHBS Peer Tutoring`,
    });
  },
);

it("falls back to SUPPORT_EMAIL and neutral contact text without empty mailto links", async () => {
  mocks.headEmail = null;
  mocks.supportEmail = "";
  render(await AboutPage());
  expect(
    screen.getByText(getAboutContent("en").team.headContactFallback),
  ).toBeTruthy();
  expect(document.querySelector('a[href^="mailto:"]')).toBeNull();

  cleanup();
  mocks.supportEmail = "support@shbs.example";
  render(await AboutPage());
  expect(
    screen
      .getByRole("link", { name: "support@shbs.example" })
      .getAttribute("href"),
  ).toBe("mailto:support@shbs.example");
});

it("hides Crew and Viewer links when their optional modules are disabled", async () => {
  mocks.features = { CREW: false, VIEWER_SIGNUP: false };
  render(await AboutPage());
  expect(screen.queryByRole("link", { name: "Join the Crew" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Follow the Program" })).toBeNull();
});

it("renders the custom editor-authored About page when enabled and gates unpublished preview to editors", async () => {
  mocks.custom = {
    title: "Custom About Title",
    titleLocale: "en",
    blocks: buildStarterAboutBlocks(),
    isPreview: false,
  };
  render(await AboutPage());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Custom About Title",
  );
  expect(screen.getByTestId("custom-about-blocks")).toBeTruthy();
  expect(screen.queryByTestId("about-stat-sessions")).toBeNull();

  // Unpublished custom draft stays hidden from non-editors even with ?preview=custom.
  cleanup();
  mocks.custom = {
    title: "Draft About",
    titleLocale: "en",
    blocks: buildStarterAboutBlocks(),
    isPreview: true,
  };
  mocks.authorize = { ok: false };
  render(await AboutPage({ searchParams: Promise.resolve({ preview: "custom" }) }));
  expect(screen.queryByTestId("custom-about-blocks")).toBeNull();
  expect(screen.getByTestId("about-stat-sessions")).toBeTruthy();

  // Authorized editors can preview the unpublished custom alternative.
  cleanup();
  mocks.authorize = { ok: true };
  render(await AboutPage({ searchParams: Promise.resolve({ preview: "custom" }) }));
  expect(screen.getByTestId("custom-about-blocks")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "preview.ribbon.back" })
      .getAttribute("href"),
  ).toBe("/admin/landing?view=pages");
});

it("keeps translated section anchors aligned and starter blocks valid", () => {
  const en = getAboutContent("en");
  const zh = getAboutContent("zh");
  const ids = (c: typeof en) => [
    c.story.id,
    c.howItWorks.id,
    c.team.id,
    c.audiences.id,
    c.getInvolved.id,
  ];
  expect(new Set(ids(en)).size).toBe(5);
  expect(ids(zh)).toEqual(ids(en));
  expect(en.team.roles.map((r) => r.id)).toEqual(zh.team.roles.map((r) => r.id));
  expect(JSON.stringify(zh)).not.toContain("SHBS");
  expect(zh.title).toContain("宏润博源");
  expect(layoutSchema.safeParse(buildStarterAboutBlocks()).success).toBe(true);
});
