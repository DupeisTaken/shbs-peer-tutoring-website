// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "VIEWER" }));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "account" } }),
}));
vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: async () => ({ role: state.role, suspendedAt: null }) },
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock("./notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("./language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("./sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("./theme-switcher", () => ({ ThemeSwitcher: () => null }));
import { WorkflowShell } from "./workflow-shell";

afterEach(cleanup);
it.each(["VIEWER", "HEAD", "ADMIN", "COORDINATOR", "TUTOR", "STUDENT", "CREW"])(
  "only offers reachable tutee onboarding from the %s workflow shell",
  async (role) => {
    state.role = role;
    render(
      await WorkflowShell({ title: "Messages", children: <div>Inbox</div> }),
    );
    const tuteeLink = screen.queryByRole("link", { name: "enterTutee" });
    if (role === "VIEWER") expect(tuteeLink).toBeNull();
    else expect(tuteeLink?.getAttribute("href")).toBe("/student");
    expect(
      screen.getByRole("link", { name: "settings" }).getAttribute("href"),
    ).toBe("/my-account");
  },
);
