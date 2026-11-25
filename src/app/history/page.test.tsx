/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import en from "../../../messages/en.json";
import HistoryPage from "./page";

const mock = vi.hoisted(() => ({
  signedIn: true,
  workspaceHeader: true,
  redirect: vi.fn(),
}));
vi.mock("~/server/auth", () => ({
  auth: async () => (mock.signedIn ? { user: { id: "student" } } : null),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mock.redirect(url);
    throw new Error("REDIRECT");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    en.tuteeHistory[key as keyof typeof en.tuteeHistory],
}));
vi.mock("./personal-history", () => ({
  PersonalTuteeHistory: () => <div>Historical enrollments</div>,
}));
vi.mock("./personal-tutor-history", () => ({
  PersonalTutorHistory: () => <div>Retained tutor history</div>,
}));
vi.mock("~/app/_components/sign-out-button", () => ({
  SignOutButton: () => <button>Sign out</button>,
}));
vi.mock("~/app/_components/signed-in-workspace-header", () => ({
  getSignedInWorkspaceHeader: async ({ title }: { title: string }) =>
    mock.workspaceHeader ? (
      <header data-header="workspace" data-title={title}>
        Workspace header
      </header>
    ) : null,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <select aria-label="Language" data-compact-desktop={compactAtDesktop}>
      <option>English</option>
    </select>
  ),
}));
beforeEach(() => {
  mock.signedIn = true;
  mock.workspaceHeader = true;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("renders the unified WorkspaceHeader beside retained personal history for active accounts", async () => {
  render(await HistoryPage());
  expect(
    document
      .querySelector('[data-header="workspace"]')
      ?.getAttribute("data-title"),
  ).toBe(en.tuteeHistory.myHistory);
  expect(
    screen.getByRole("heading", { name: en.tuteeHistory.myHistory }),
  ).toBeTruthy();
  expect(screen.getByText("Historical enrollments")).toBeTruthy();
  expect(screen.getByText("Retained tutor history")).toBeTruthy();
  // Loose pre-header SignOutButton and WorkspaceLinks are not duplicated when WorkspaceHeader is active.
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("falls back to shared public navigation and sign-out when WorkspaceHeader is unavailable", async () => {
  mock.workspaceHeader = false;
  render(await HistoryPage());
  expect(
    screen.getByRole("heading", { name: en.tuteeHistory.myHistory }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: en.tuteeHistory.settings })
      .getAttribute("href"),
  ).toBe("/my-account");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
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
});

it("preserves the existing sign-in return destination", async () => {
  mock.signedIn = false;
  await expect(HistoryPage()).rejects.toThrow("REDIRECT");
  expect(mock.redirect).toHaveBeenCalledWith("/signin?callbackUrl=%2Fhistory");
});

vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
