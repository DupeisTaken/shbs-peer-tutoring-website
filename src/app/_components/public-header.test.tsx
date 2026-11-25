// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, expect, it, vi } from "vitest";
import { PublicHeader } from "./public-header";
import { BrandingProvider } from "./branding-provider";
import { resolveBranding } from "~/lib/branding-config";
import { Markdown } from "./markdown";
import NotFound from "../not-found";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("./help-link", () => ({
  HelpLink: () => <Link href="/help">Help Center</Link>,
}));
vi.mock("./language-switcher", () => ({
  LanguageSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <select aria-label="Language" data-compact={compactAtDesktop}>
      <option>English</option>
    </select>
  ),
}));
vi.mock("./theme-switcher", () => ({
  ThemeSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <button data-compact={compactAtDesktop}>Theme</button>
  ),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => {
    let value: unknown = state.locale === "zh" ? zh : en;
    for (const part of key.split("."))
      value = (value as Record<string, unknown>)[part];
    return value;
  },
}));
afterEach(cleanup);
it("renders one set of compact utilities with a wrapping configured brand", () => {
  render(
    <BrandingProvider
      branding={resolveBranding({
        APP_TITLE: "Long translated programme title",
      })}
    >
      <PublicHeader navigation={<a href="/signup">Apply</a>} />
    </BrandingProvider>,
  );
  const brandLink = screen.getByRole("link", {
    name: "Long translated programme title",
  });
  expect(brandLink.getAttribute("href")).toBe("/");
  expect(
    brandLink
      .querySelector<HTMLImageElement>("[data-brand-mark] img")
      ?.getAttribute("src"),
  ).toBe("/icon.png");
  expect(screen.getAllByRole("combobox", { name: "Language" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Theme" })).toHaveLength(1);
  expect(
    screen.getByRole("link", { name: "Help Center" }).getAttribute("href"),
  ).toBe("/help");
  expect(screen.getByRole("combobox").getAttribute("data-compact")).toBe(
    "true",
  );
  expect(screen.getByRole("banner").hasAttribute("data-sticky-header")).toBe(
    true,
  );
});
it.each(["en", "zh"])(
  "provides localized branded not-found recovery with one page heading (%s)",
  async (locale) => {
    state.locale = locale;
    const copy = locale === "en" ? en : zh;
    render(await NotFound());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      copy.pageRecovery.title,
    );
    expect(screen.queryByRole("link", { name: copy.common.backToMain })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: copy.workflows.home })
        .getAttribute("href"),
    ).toBe("/");
    expect(
      document.querySelector("header a[href='/']")?.getAttribute("title"),
    ).toBe(copy.common.backToMain);
    expect(
      screen
        .getByRole("link", { name: copy.auth.register.done.signIn })
        .getAttribute("href"),
    ).toBe("/signin");
    expect(screen.getByText(copy.pageRecovery.body)).toBeTruthy();
  },
);
it("keeps embedded markdown titles below the owning page H1", () => {
  render(
    <>
      <h1>Policy page</h1>
      <Markdown>{"# Document title\n\nPolicy text"}</Markdown>
    </>,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    screen.getByRole("heading", { level: 2, name: "Document title" }),
  ).toBeTruthy();
});
