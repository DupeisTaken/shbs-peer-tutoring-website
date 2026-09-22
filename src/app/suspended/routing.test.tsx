import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
const mocks = vi.hoisted(() => ({
  session: null as Session | null,
  account: { suspendedAt: new Date(), crewStatus: "ACTIVE" },
}));
vi.mock("~/server/auth", () => ({ auth: async () => mocks.session }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: async () => mocks.account } } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("~/server/program/features", () => ({ getFeatures: async () => ({ CREW: false }) }));
vi.mock("~/app/_components/landing-view", () => ({ LandingView: () => null }));
vi.mock("~/app/_components/workspace-header", () => ({ WorkspaceHeader: () => null }));
vi.mock("~/app/_components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("~/app/_components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("~/app/_components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("~/app/_components/theme-switcher", () => ({ ThemeSwitcher: () => null }));
import Home from "../page";
import TutorLayout from "../(tutor)/layout";
import PatrolLayout from "../patrol/layout";
beforeEach(() => {
  mocks.session = { user: { id: "suspended" }, role: "TUTOR", tutorId: null, expires: "2099-01-01" };
});
it.each(["HEAD", "ADMIN", "COORDINATOR", "TUTOR", "STUDENT", "CREW", "VIEWER"] as const)(
  "sends suspended %s accounts directly to appeal after sign-in", async (role) => {
    mocks.session!.role = role;
    await expect(Home()).rejects.toThrow("redirect:/suspended");
  },
);
it("routes a suspended tutor before checking their missing tutor link", async () => {
  await expect(TutorLayout({ children: null })).rejects.toThrow("redirect:/suspended");
});
it("routes suspended crew to appeal even with the crew module disabled", async () => {
  mocks.session!.role = "CREW";
  await expect(PatrolLayout({ children: null })).rejects.toThrow("redirect:/suspended");
});
