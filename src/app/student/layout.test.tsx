// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TuteeLayout from "./layout";
import AdminLayout from "../(admin)/layout";
import TutorLayout from "../(tutor)/layout";
import LocalizationLayout from "../localization/layout";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  user: vi.fn(),
  tutor: vi.fn(),
  features: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.user }, tutor: { findUnique: mocks.tutor } },
}));
vi.mock("~/app/_components/admin-nav", () => ({
  NavSidebar: () => null,
  NavMobileRow: () => <nav aria-label="Mobile management navigation" />,
}));
vi.mock("~/app/_components/dismissible-notice", () => ({
  AdminPreferenceIdentity: () => null,
}));
vi.mock("~/app/_components/sign-out-button", () => ({
  SignOutButton: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: mocks.messages,
}));
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({
    children,
    messages,
  }: {
    children: ReactNode;
    messages: unknown;
  }) => (
    <div data-testid="period-messages" data-messages={JSON.stringify(messages)}>
      {children}
    </div>
  ),
}));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/app/_components/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("~/app/_components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("~/app/_components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("~/app/_components/user-avatar", () => ({
  UserAvatar: ({ items }: { items: { href: string; label: string }[] }) => (
    <nav aria-label="Account destinations">
      {items.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));
vi.mock("./navigation", () => ({ TuteeNavigation: () => null }));
beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "account" } });
  mocks.features.mockResolvedValue({ QUARTER_SYSTEM: true });
  mocks.messages.mockResolvedValue({
    workflow: {
      noActive: "Quarter enrollment",
      semesterCopy: { noActive: "Semester enrollment" },
    },
  });
});
afterEach(cleanup);
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps mobile management navigation in %s translation workspaces",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role });
    mocks.user.mockResolvedValue({ canTranslate: false });
    render(await LocalizationLayout({ children: null }));
    expect(
      screen.getByRole("navigation", { name: "Mobile management navigation" }),
    ).toBeTruthy();
    expect(screen.getByText(`admin.users.roles.${role}`)).toBeTruthy();
  },
);
it("keeps assigned translators focused and redirects suspended translators", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "account" }, role: "VIEWER" });
  mocks.user.mockResolvedValue({ canTranslate: true });
  render(await LocalizationLayout({ children: null }));
  expect(
    screen.queryByRole("navigation", { name: "Mobile management navigation" }),
  ).toBeNull();
  mocks.user.mockResolvedValue({ canTranslate: true, suspendedAt: new Date() });
  await expect(LocalizationLayout({ children: null })).rejects.toThrow(
    "redirect:/suspended",
  );
});
it.each([
  ["admin", AdminLayout, true],
  ["admin", AdminLayout, false],
  ["tutor", TutorLayout, true],
  ["tutor", TutorLayout, false],
] as const)(
  "%s menu follows the effective crew flag (%s)",
  async (_area, Layout, enabled) => {
    mocks.auth.mockResolvedValue({
      user: { id: "account" },
      role: "HEAD",
      tutorId: "tutor",
    });
    mocks.user.mockResolvedValue({
      role: "HEAD",
      crewStatus: "ACTIVE",
      emailVerifiedAt: new Date(),
      mustChangePassword: false,
      tutor: { status: "ACTIVE", username: "alice" },
    });
    mocks.tutor.mockResolvedValue({ id: "tutor", status: "ACTIVE" });
    mocks.features.mockResolvedValue({ CREW: enabled });
    render(await Layout({ children: null }));
    expect(!!screen.queryByRole("link", { name: "crew.nav.patrol" })).toBe(
      enabled,
    );
  },
);
it("preserves crew and translator return paths from the tutee workspace", async () => {
  mocks.features.mockResolvedValue({ QUARTER_SYSTEM: true, CREW: true });
  mocks.user.mockResolvedValue({
    name: "Crew Translator",
    role: "CREW",
    crewStatus: "ACTIVE",
    canTranslate: true,
  });
  render(await TuteeLayout({ children: null }));
  expect(
    screen.getByRole("link", { name: "crew.nav.patrol" }).getAttribute("href"),
  ).toBe("/patrol");
  expect(
    screen
      .getByRole("link", { name: "localization.navLabel" })
      .getAttribute("href"),
  ).toBe("/localization");
});
it("hides the crew return link when the module is disabled", async () => {
  mocks.features.mockResolvedValue({ QUARTER_SYSTEM: true, CREW: false });
  mocks.user.mockResolvedValue({
    name: "Crew",
    role: "CREW",
    crewStatus: "ACTIVE",
  });
  render(await TuteeLayout({ children: null }));
  expect(screen.queryByRole("link", { name: "crew.nav.patrol" })).toBeNull();
});
it.each(["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "TUTOR", "CREW", "STUDENT"])(
  "allows %s accounts without requiring a tutee profile or verification change",
  async (role) => {
    mocks.user.mockResolvedValue({
      name: "Current account name",
      username: "name",
      email: "name@example.test",
      role,
      suspendedAt: null,
      tutor: null,
    });
    render(await TuteeLayout({ children: <p>My tutoring</p> }));
    expect(screen.getByText("My tutoring")).toBeTruthy();
    expect(screen.getByText("Current account name")).toBeTruthy();
  },
);
it("keeps unauthenticated access behind sign-in", async () => {
  mocks.auth.mockResolvedValue(null);
  await expect(TuteeLayout({ children: null })).rejects.toThrow(
    "redirect:/signin",
  );
});
it("preserves account suspension enforcement", async () => {
  mocks.user.mockResolvedValue({ suspendedAt: new Date() });
  await expect(TuteeLayout({ children: null })).rejects.toThrow(
    "redirect:/suspended",
  );
});

it("uses applied semester wording only within the tutee workspace", async () => {
  mocks.features.mockResolvedValue({ QUARTER_SYSTEM: false });
  mocks.user.mockResolvedValue({
    name: "Sam",
    username: "sam",
    email: "sam@example.test",
    role: "ADMIN",
    suspendedAt: null,
    tutor: null,
  });
  render(await TuteeLayout({ children: <p>Requests</p> }));
  expect(
    screen.getByTestId("period-messages").getAttribute("data-messages"),
  ).toContain('"noActive":"Semester enrollment"');
});
it("keeps the inherited quarter messages when quarter mode is applied", async () => {
  mocks.user.mockResolvedValue({
    name: "Sam",
    username: "sam",
    email: "sam@example.test",
    role: "TUTOR",
    suspendedAt: null,
    tutor: null,
  });
  render(await TuteeLayout({ children: <p>Requests</p> }));
  expect(screen.queryByTestId("period-messages")).toBeNull();
});
