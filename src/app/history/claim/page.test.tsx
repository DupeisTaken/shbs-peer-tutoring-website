/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import en from "../../../../messages/en.json";
import HistoryClaimPage from "./page";

const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock("~/server/auth", () => ({
  auth: async () =>
    session.signedIn ? { user: { id: "historical-owner" } } : null,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    en.tuteeHistory[key as keyof typeof en.tuteeHistory],
}));
vi.mock("./history-claim", async () => {
  const { useState } = await import("react");
  return {
    // A stateful stand-in exposes the parent's actual reconciliation boundary;
    // the feature tests separately cover the real read/write behavior.
    HistoryClaim: () => {
      const [completed, setCompleted] = useState(false);
      return completed ? (
        <p role="status">Synthetic claim receipt</p>
      ) : (
        <button onClick={() => setCompleted(true)}>
          Confirm synthetic claim
        </button>
      );
    },
  };
});
vi.mock("./history-account-setup", () => ({
  HistoryAccountSetup: () => <div>Account setup form</div>,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <select aria-label="Language" data-compact-desktop={compactAtDesktop}>
      <option>English</option>
    </select>
  ),
}));
vi.mock("./actions", () => ({ switchHistoryAccount: vi.fn() }));
beforeEach(() => {
  session.signedIn = false;
});
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
    screen
      .getByRole("link", { name: en.tuteeHistory.back })
      .getAttribute("href"),
  ).toBe("/");
  expect(screen.getAllByRole("combobox", { name: "Language" })).toHaveLength(1);
  expect(
    screen
      .getByRole("combobox", { name: "Language" })
      .getAttribute("data-compact-desktop"),
  ).toBe("true");
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

it("keeps the effective invitation controller through irrelevant token changes and remounts for a different invitation", async () => {
  session.signedIn = true;
  const token = "a".repeat(64);
  const page = (value: string, invitation: string) =>
    HistoryClaimPage({
      searchParams: Promise.resolve({ token: value, invitation }),
    });
  const view = render(await page(token, "first-invitation"));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm synthetic claim" }),
  );
  view.rerender(await page("b".repeat(64), "first-invitation"));
  expect(screen.getByRole("status").textContent).toBe(
    "Synthetic claim receipt",
  );
  view.rerender(await page("b".repeat(64), "second-invitation"));
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Confirm synthetic claim" }),
  ).toBeTruthy();
});

it("remounts when switching capability kinds even if their identifiers are identical", async () => {
  session.signedIn = true;
  const token = "a".repeat(64);
  const view = render(
    await HistoryClaimPage({ searchParams: Promise.resolve({ token }) }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm synthetic claim" }),
  );
  view.rerender(
    await HistoryClaimPage({
      searchParams: Promise.resolve({ token, invitation: token }),
    }),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Confirm synthetic claim" }),
  ).toBeTruthy();
});

vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
