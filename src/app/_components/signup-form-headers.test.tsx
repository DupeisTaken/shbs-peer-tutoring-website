// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const state = vi.hoisted(() => ({
  locale: "en",
  session: null as { user: { id: string; email?: string } } | null,
  account: null as Record<string, unknown> | null,
  features: { CREW: true, VIEWER_SIGNUP: true },
}));

vi.mock("~/server/auth", () => ({ auth: async () => state.session }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: async () => state.account } },
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => state.features,
}));
vi.mock("~/server/program/public-signup-transition", () => ({
  readPublicSignupTransition: async () => ({
    serverNow: "2026-10-30T00:00:00Z",
    timeZone: "Asia/Shanghai",
    current: { termId: "t1", label: "2026-27 Q1", kind: "quarter", window: { enabled: true, opensAt: null, closesAt: null, previewUrl: null } },
    next: null,
  }),
}));
vi.mock("~/server/student-intake-restriction", () => ({
  readStudentSignupRestriction: async () => ({ blocked: false, canOpenWorkspace: false }),
}));
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace?: string) => {
    const fn = (key: string) => {
      let value: unknown = state.locale === "zh" ? zh : en;
      for (const part of (namespace ? `${namespace}.${key}` : key).split("."))
        value = (value as Record<string, unknown>)[part];
      return typeof value === "string" ? value : key;
    };
    return Object.assign(fn, { has: () => true });
  },
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("~/app/_components/help-link", () => ({
  HelpLink: () => null,
}));
vi.mock("~/app/_components/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("~/app/_components/user-avatar", () => ({
  UserAvatar: () => <button>Account</button>,
}));
vi.mock("~/app/signup/signup-form", () => ({ SignupForm: () => <div>Tutee form</div> }));
vi.mock("~/app/signup/signup-intro", () => ({ SignupIntro: () => null }));
vi.mock("~/app/signup/student-registration", () => ({
  StudentRegistration: () => <div>Confirm form</div>,
}));
vi.mock("~/app/tutee-signup/appeal/signup-appeal", () => ({
  SignupAppeal: () => <div>Appeal form</div>,
}));
vi.mock("~/app/tutor-signup/tutor-signup-form", () => ({
  TutorSignupForm: () => <div>Tutor form</div>,
}));
vi.mock("~/app/crew-signup/crew-signup-form", () => ({
  CrewSignupForm: () => <div>Crew form</div>,
}));
vi.mock("~/app/viewer-signup/viewer-signup-flow", () => ({
  ViewerSignupFlow: () => <div>Viewer form</div>,
}));
vi.mock("~/app/register/register-flow", () => ({
  RegisterFlow: () => <div>Register form</div>,
}));

import SignupPage from "~/app/signup/page";
import StudentAccountPage from "~/app/signup/account/page";
import SignupAppealPage from "~/app/tutee-signup/appeal/page";
import TutorSignupPage from "~/app/tutor-signup/page";
import CrewSignupPage from "~/app/crew-signup/page";
import ViewerSignupPage from "~/app/viewer-signup/page";
import RegisterPage from "~/app/register/page";

beforeEach(() => {
  state.locale = "en";
  state.session = null;
  state.account = null;
  state.features = { CREW: true, VIEWER_SIGNUP: true };
});
afterEach(cleanup);

const signupPages = [
  ["/tutee-signup", "/", () => SignupPage()],
  [
    "/tutee-signup/account",
    "/tutee",
    () => StudentAccountPage({ searchParams: Promise.resolve({}) }),
  ],
  ["/tutee-signup/appeal", "/tutee", () => SignupAppealPage()],
  ["/tutor-signup", "/", () => TutorSignupPage()],
  ["/crew-signup", "/", () => CrewSignupPage()],
  ["/viewer-signup", "/", () => ViewerSignupPage()],
  ["/register", "/", () => RegisterPage()],
] as const;

it.each(["en", "zh"] as const)(
  "renders (PT) Signup Forms header with return link on logo and no extra banner links when signed out (%s)",
  async (locale) => {
    state.locale = locale;
    const copy = locale === "zh" ? zh : en;
    const expected = copy.components.workspaceTitles.signupForms;
    for (const [route, expectedHref, renderPage] of signupPages) {
      const { container, unmount } = render(await renderPage());
      const brand = screen.getByRole("link", { name: expected });
      expect(brand.getAttribute("href"), route).toBe(expectedHref);
      expect(
        container.querySelector<HTMLImageElement>("[data-brand-mark] img")?.getAttribute("src"),
        route,
      ).toBe("/icon.png");
      expect(
        screen.queryByRole("link", { name: copy.common.backToMain }),
        route,
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: copy.survey.back }),
        route,
      ).toBeNull();
      unmount();
    }
  },
);

it("shows (PT) Signup Forms in WorkspaceHeader when signed in and keeps Signup Forms out of the switcher selection", async () => {
  state.session = { user: { id: "u1", email: "alex@example.test" } };
  state.account = {
    name: "Alex",
    email: "alex@example.test",
    username: "alex",
    role: "ADMIN",
    suspendedAt: null,
    mergedIntoId: null,
    studentId: null,
    tuteeMember: true,
    crewStatus: "ACTIVE",
    tutorAccessRevoked: false,
    canTranslate: true,
    schoolDeparture: null,
    tutor: { username: "alex", status: "ACTIVE" },
  };
  const { container } = render(await TutorSignupPage());
  const summary = container.querySelector("summary");
  expect(summary).toBeTruthy();
  expect(summary?.textContent).toContain("Signup Forms");
  expect(
    summary?.querySelector<HTMLImageElement>("[data-brand-mark] img")?.getAttribute("src"),
  ).toBe("/icon.png");

  const switcherNav = screen.getByRole("navigation", {
    name: en.components.workspaceSwitcher.label,
  });
  const switcherLinks = [...switcherNav.querySelectorAll("a")];
  expect(switcherLinks.map((link) => link.textContent)).not.toContain(
    "Signup Forms",
  );
  expect(switcherLinks.map((link) => link.getAttribute("href"))).toEqual([
    "/admin",
    "/dashboard",
    "/student",
    "/patrol",
    "/localization",
    "/",
    "/help",
  ]);
});
