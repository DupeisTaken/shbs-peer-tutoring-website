/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import en from "../../../../messages/en.json";
import HistoryClaimPage from "./page";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    en.tuteeHistory[key as keyof typeof en.tuteeHistory],
}));
vi.mock("./history-claim", () => ({ HistoryClaim: () => null }));
vi.mock("./history-account-setup", () => ({
  HistoryAccountSetup: () => <div>Account setup form</div>,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("./actions", () => ({ switchHistoryAccount: vi.fn() }));
afterEach(cleanup);

it("preserves the invitation through sign-in and provides recovery and history-only setup", async () => {
  const token = "a".repeat(64);
  render(await HistoryClaimPage({ searchParams: Promise.resolve({ token }) }));
  const signin = screen.getByRole("link", { name: en.tuteeHistory.signIn });
  const url = new URL(signin.getAttribute("href")!, "https://example.test");
  expect(url.pathname).toBe("/signin");
  expect(url.searchParams.get("callbackUrl")).toBe(
    `/history/claim?token=${token}`,
  );
  expect(
    screen
      .getByRole("link", { name: en.tuteeHistory.recoverAccount })
      .getAttribute("href"),
  ).toBe("/forgot-password");
  expect(screen.getByText("Account setup form")).toBeTruthy();
  expect(screen.getByText(en.tuteeHistory.historySupport)).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: en.tuteeHistory.signup }),
  ).toBeNull();
});

it("encodes malformed token content as data in a fixed local return route", async () => {
  render(
    await HistoryClaimPage({
      searchParams: Promise.resolve({ token: "x&callbackUrl=//evil.test" }),
    }),
  );
  const url = new URL(
    screen
      .getByRole("link", { name: en.tuteeHistory.signIn })
      .getAttribute("href")!,
    "https://example.test",
  );
  expect(url.searchParams.get("callbackUrl")).toBe(
    "/history/claim?token=x%26callbackUrl%3D%2F%2Fevil.test",
  );
});
