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

const mocks = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({ getFeatures: async () => ({}) }));
vi.mock("~/server/home/content", () => ({
  getHomeOverrides: async () => ({}),
  applyHomeVars: (text: string) => text,
}));
vi.mock("~/server/home/news", () => ({ getLandingNews: async () => [] }));
vi.mock("~/server/home/sections", () => ({
  getLandingSections: async () => [],
}));
vi.mock("~/server/home/blocks", () => ({ getLandingLayout: async () => [] }));
vi.mock("~/server/home/pages", () => ({ getNavPages: async () => [] }));
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
afterEach(cleanup);

it.each([
  ["en", "Privacy policy"],
  ["zh", "隐私政策"],
  ["fr", "Privacy policy"],
])(
  "keeps the %s privacy links when landing content is empty",
  async (locale, label) => {
    mocks.locale = locale!;
    render(await LandingView({}));
    expect(
      within(screen.getByRole("contentinfo"))
        .getByRole("link", { name: label })
        .getAttribute("href"),
    ).toBe("/privacy");
    for (const menu of ["nav.menu", "nav.accessProgramInformation"]) {
      fireEvent.click(screen.getByRole("button", { name: menu }));
      expect(
        within(screen.getByRole("dialog", { name: menu }))
          .getByRole("link", { name: label })
          .getAttribute("href"),
      ).toBe("/privacy");
    }
  },
);
