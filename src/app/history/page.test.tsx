/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import en from "../../../messages/en.json";
import HistoryPage from "./page";

const mock = vi.hoisted(() => ({ signedIn: true, redirect: vi.fn() }));
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
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: ({ compactAtDesktop }: { compactAtDesktop: boolean }) => (
    <select aria-label="Language" data-compact-desktop={compactAtDesktop}>
      <option>English</option>
    </select>
  ),
}));
beforeEach(() => {
  mock.signedIn = true;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("offers the shared language and home navigation beside retained personal history", async () => {
  render(await HistoryPage());
  expect(
    screen.getByRole("heading", { name: en.tuteeHistory.myHistory }),
  ).toBeTruthy();
  expect(screen.getByText("Historical enrollments")).toBeTruthy();
  expect(screen.getByText("Retained tutor history")).toBeTruthy();
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
