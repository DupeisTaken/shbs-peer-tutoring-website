import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  account: {
    role: "ADMIN",
    canTranslate: false,
    suspendedAt: null as Date | null,
    tutor: null,
  },
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "synthetic" }, role: "HEAD" }),
}));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: async () => mocks.account } },
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("~/app/_components/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("~/app/_components/sign-out-button", () => ({
  SignOutButton: () => null,
}));
vi.mock("~/app/_components/admin-nav", () => ({
  NavSidebar: () => null,
  NavMobileRow: () => null,
}));
import LocalizationLayout from "./layout";
import RetiredPage from "../translation-review/page";
beforeEach(() => {
  mocks.account = {
    role: "ADMIN",
    canTranslate: false,
    suspendedAt: null,
    tutor: null,
  };
});
it("redirects old direct access to integrated review", () => {
  expect(() => RetiredPage()).toThrow("redirect:/localization?view=review");
});
it("admits management reviewers without editing assignment", async () => {
  await expect(LocalizationLayout({ children: null })).resolves.toBeTruthy();
});
it("checks live revocation and suspension instead of the session rank", async () => {
  mocks.account.role = "STUDENT";
  await expect(LocalizationLayout({ children: null })).rejects.toThrow(
    "redirect:/",
  );
  mocks.account.canTranslate = true;
  mocks.account.suspendedAt = new Date();
  await expect(LocalizationLayout({ children: null })).rejects.toThrow(
    "redirect:/suspended",
  );
});
it("has no navigation or notification callers targeting the retired route", () => {
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(path) && !path.includes(".test."))
        expect(readFileSync(path, "utf8"), path).not.toMatch(
          /(?:href[:=]\s*|link:\s*)["']\/translation-review/,
        );
    }
  };
  visit(join(process.cwd(), "src"));
});
