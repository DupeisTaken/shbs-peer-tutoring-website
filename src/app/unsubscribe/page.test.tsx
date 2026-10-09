// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import Page, { generateMetadata } from "./page";

vi.mock("~/server/branding-metadata", () => ({
  brandingMetadata: async (title: string) => ({ title }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace?: string) => (key: string) => {
    let value: unknown = en;
    for (const part of (namespace ? `${namespace}.${key}` : key).split("."))
      value = (value as Record<string, unknown>)[part];
    return value;
  },
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("./unsubscribe-form", () => ({
  UnsubscribeForm: ({ token }: { token?: string }) => (
    <div data-testid="form" data-has-token={Boolean(token)} />
  ),
}));
afterEach(cleanup);

it("keeps the capability page out of search and prevents token-bearing referrers", async () => {
  expect(await generateMetadata()).toMatchObject({
    title: en.unsubscribe.title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  });
});

it("provides account settings through sign-in and a public home route", async () => {
  render(await Page({ searchParams: Promise.resolve({ token: "opaque" }) }));
  expect(screen.getByTestId("form").getAttribute("data-has-token")).toBe(
    "true",
  );
  expect(
    screen
      .getByRole("link", { name: en.unsubscribe.manage })
      .getAttribute("href"),
  ).toBe("/signin?callbackUrl=%2Fmy-account");
  expect(
    screen
      .getByRole("link", { name: en.common.backToMain })
      .getAttribute("href"),
  ).toBe("/");
  expect(document.body.textContent).not.toContain("opaque");
});

it("rejects ambiguous repeated token parameters", async () => {
  render(
    await Page({
      searchParams: Promise.resolve({ token: ["first", "second"] }),
    }),
  );
  expect(screen.getByTestId("form").getAttribute("data-has-token")).toBe(
    "false",
  );
});
