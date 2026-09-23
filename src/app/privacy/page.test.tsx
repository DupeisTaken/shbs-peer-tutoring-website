// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import PrivacyPage, { generateMetadata } from "./page";
import { getPrivacyPolicy } from "~/lib/privacy-policy";

const mocks = vi.hoisted(() => ({ locale: "en", email: "" }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/lib/branding", () => ({
  APP_TITLE: "Example tutoring",
  ORG_NAME: "Example school",
  get SUPPORT_EMAIL() {
    return mocks.email;
  },
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => <select aria-label="Language" />,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => <button>Theme</button>,
}));
afterEach(() => {
  cleanup();
  mocks.email = "";
  mocks.locale = "en";
});

it.each(["en", "zh", "fr", "custom"])(
  "renders a complete, navigable document for %s",
  async (locale) => {
    mocks.locale = locale;
    const policy = getPrivacyPolicy(locale);
    render(await PrivacyPage());
    const article = screen.getByRole("article", { name: policy.title });
    expect(article.lang).toBe(locale === "zh" ? "zh" : "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      policy.title,
    );
    for (const link of within(screen.getByRole("navigation")).getAllByRole(
      "link",
    )) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id)?.textContent).toContain(
        link.textContent,
      );
    }
    expect(within(article).getAllByRole("heading", { level: 2 })).toHaveLength(
      9,
    );
    expect(
      screen.getByRole("link", { name: "backToMain" }).getAttribute("href"),
    ).toBe("/");
    expect(await generateMetadata()).toMatchObject({
      title: `${policy.title} | Example tutoring`,
    });
  },
);

it("offers a school contact route without creating an empty mail link", async () => {
  render(await PrivacyPage());
  expect(screen.getByText(getPrivacyPolicy("en").contactFallback)).toBeTruthy();
  expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
});

it("uses the configured support address and organization", async () => {
  mocks.email = "privacy@example.test";
  render(await PrivacyPage());
  expect(
    screen.getByRole("link", { name: mocks.email }).getAttribute("href"),
  ).toBe(`mailto:${mocks.email}`);
  expect(screen.getByText("Example school")).toBeTruthy();
});

it("keeps translated section anchors aligned", () => {
  const ids = getPrivacyPolicy("en").sections.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(getPrivacyPolicy("zh").sections.map(({ id }) => id)).toEqual(ids);
});
