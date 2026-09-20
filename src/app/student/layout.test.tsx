// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
  currentPolicy: vi.fn(),
  acceptance: vi.fn(),
  pastAcceptance: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: mocks.user },
    tutor: { findUnique: mocks.tutor },
    policyAcceptance: {
      findUnique: mocks.acceptance,
      findFirst: mocks.pastAcceptance,
    },
  },
}));
vi.mock("~/server/policy-acceptance", () => ({
  currentPolicy: mocks.currentPolicy,
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
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "account" } });
  // Navigation fixtures represent members with personal consent; gate cases override it.
  mocks.currentPolicy.mockResolvedValue({ revision: "published-policy" });
  mocks.acceptance.mockResolvedValue({ revision: "published-policy" });
  mocks.pastAcceptance.mockResolvedValue(null);
  mocks.features.mockResolvedValue({ QUARTER_SYSTEM: true });
  mocks.messages.mockResolvedValue({
    workflow: {
      noActive: "Quarter enrollment",
      semesterCopy: { noActive: "Semester enrollment" },
    },
  });
});
afterEach(cleanup);
// Management membership does not grant tutoring; tutee access stays independent.
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "lets %s without a tutor profile enter tutee and return safely",
  async (role) => {
    mocks.auth.mockResolvedValue({
      user: { id: "account" },
      role,
      tutorId: null,
    });
    mocks.user.mockResolvedValue({ role, tutor: null, tuteeMember: true });
    const management = render(
      await AdminLayout({ children: <p>Management</p> }),
    );
    expect(
      screen.getAllByRole("link", { name: "components.userMenu.enterTutee" }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "components.userMenu.enterTutor" }),
    ).toBeNull();
    management.unmount();
    render(await TuteeLayout({ children: <p>Tutee content</p> }));
    expect(screen.getByText("Tutee content")).toBeTruthy();
    expect(
      screen.getAllByRole("link", {
        name: "components.userMenu.backToManagement",
      }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "components.userMenu.enterTutor" }),
    ).toBeNull();
    await expect(TutorLayout({ children: null })).rejects.toThrow("redirect:/");
  },
);
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps mobile management navigation in %s translation workspaces",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role });
    mocks.user.mockResolvedValue({ canTranslate: true });
    render(await LocalizationLayout({ children: null }));
    expect(
      screen.getByRole("navigation", { name: "Mobile management navigation" }),
    ).toBeTruthy();
    expect(screen.getByText(`admin.users.roles.${role}`)).toBeTruthy();
  },
);
it.each(["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "STUDENT"])(
  "denies the translation workspace to %s without explicit Translator membership",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role });
    mocks.user.mockResolvedValue({ role, canTranslate: false });
    await expect(LocalizationLayout({ children: null })).rejects.toThrow(
      "redirect:/",
    );
  },
);
it("keeps assigned translators focused and redirects suspended translators", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "account" }, role: "STUDENT" });
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
    tuteeMember: true,
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
    tuteeMember: true,
    crewStatus: "ACTIVE",
  });
  render(await TuteeLayout({ children: null }));
  expect(screen.queryByRole("link", { name: "crew.nav.patrol" })).toBeNull();
});
it.each(["HEAD", "ADMIN", "COORDINATOR", "TUTOR", "CREW", "STUDENT"])(
  "allows %s tutee members without requiring a tutee profile or verification change",
  async (role) => {
    mocks.user.mockResolvedValue({
      name: "Current account name",
      username: "name",
      email: "name@example.test",
      role,
      tuteeMember: true,
      suspendedAt: null,
      tutor: null,
    });
    render(await TuteeLayout({ children: <p>My tutoring</p> }));
    expect(screen.getByText("My tutoring")).toBeTruthy();
    expect(screen.getByText("Current account name")).toBeTruthy();
  },
);
it("keeps Viewer participation unavailable in management and tutee workspaces", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "account" },
    role: "VIEWER",
    tutorId: null,
  });
  mocks.user.mockResolvedValue({
    role: "VIEWER",
    tutor: null,
    tuteeMember: false,
    canTranslate: false,
  });
  render(await AdminLayout({ children: null }));
  expect(
    screen.queryByRole("link", { name: "components.userMenu.enterTutee" }),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "components.userMenu.enterTutor" }),
  ).toBeNull();
  await expect(TuteeLayout({ children: null })).rejects.toThrow(
    "redirect:/admin/account",
  );
  await expect(TutorLayout({ children: null })).rejects.toThrow("redirect:/");
  expect(mocks.currentPolicy).not.toHaveBeenCalled();
});
it.each(["HEAD", "TUTOR"])(
  "keeps %s tutee content gated until membership and personal consent exist",
  async (role) => {
    mocks.user.mockResolvedValue({
      role, tutor: { status: "ACTIVE" }, tuteeMember: false,
    });
    const withoutMembership = render(
      await TuteeLayout({ children: <p>Private tutee content</p> }),
    );
    expect(screen.queryByText("Private tutee content")).toBeNull();
    expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
    withoutMembership.unmount();

    mocks.user.mockResolvedValue({
      role, tutor: { status: "ACTIVE" }, tuteeMember: true,
    });
    mocks.acceptance.mockResolvedValue(null);
    const withoutConsent = render(
      await TuteeLayout({ children: <p>Private tutee content</p> }),
    );
    expect(screen.queryByText("Private tutee content")).toBeNull();
    expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
    withoutConsent.unmount();

    mocks.acceptance.mockResolvedValue({ revision: "published-policy" });
    render(
      await TuteeLayout({ children: <p>Private tutee content</p> }),
    );
    expect(screen.getByText("Private tutee content")).toBeTruthy();
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
    tuteeMember: true,
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
    tuteeMember: true,
    suspendedAt: null,
    tutor: null,
  });
  render(await TuteeLayout({ children: <p>Requests</p> }));
  expect(screen.queryByTestId("period-messages")).toBeNull();
});

// Exercise the real layouts: each shortcut must also retain the same menu destination.
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps tutor/tutee management shortcuts adjacent for %s",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role });
    mocks.user.mockResolvedValue({ tutor: { status: "ACTIVE" } });
    const { container } = render(await AdminLayout({ children: null }));
    const menu = screen.getByRole("navigation", {
      name: "Account destinations",
    });
    const menuLinks = within(menu).getAllByRole("link");
    expect(
      menuLinks.slice(0, 2).map((link) => link.getAttribute("href")),
    ).toEqual(["/dashboard", "/student"]);
    const shortcuts = [...container.querySelectorAll("header a")].filter(
      (link) =>
        !menu.contains(link) &&
        ["/dashboard", "/student"].includes(link.getAttribute("href")!),
    );
    expect(shortcuts.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/student",
    ]);
    expect(shortcuts.map((link) => link.textContent)).toEqual([
      "components.userMenu.enterTutor",
      "components.userMenu.enterTutee",
    ]);
  },
);
it.each([null, { status: "ARCHIVED" }])(
  "hides ineligible tutor entry in both management destinations (%j)",
  async (tutor) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role: "ADMIN" });
    mocks.user.mockResolvedValue({ tutor });
    render(await AdminLayout({ children: null }));
    expect(
      screen.queryByRole("link", { name: "components.userMenu.enterTutor" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "components.userMenu.enterTutee" }),
    ).toHaveLength(2);
  },
);
for (const [area, Layout] of [
  ["tutor", TutorLayout],
  ["tutee", TuteeLayout],
] as const) {
  it.each([
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "TUTOR",
    "CREW",
    "STUDENT",
  ])(
    `${area} exposes a management return only to authorized %s accounts`,
    async (role) => {
      mocks.auth.mockResolvedValue({
        user: { id: "account" },
        role,
        tutorId: "tutor",
      });
      mocks.user.mockResolvedValue({
        role,
        tuteeMember: true,
        emailVerifiedAt: new Date(),
        tutor: { status: "ACTIVE" },
      });
      mocks.tutor.mockResolvedValue({ id: "tutor", status: "ACTIVE" });
      const { container } = render(await Layout({ children: null }));
      const links = screen.queryAllByRole("link", {
        name: "components.userMenu.backToManagement",
      });
      const allowed = ["HEAD", "ADMIN", "COORDINATOR"].includes(role);
      expect(links).toHaveLength(allowed ? 2 : 0);
      if (allowed) {
        expect(
          links.every((link) => link.getAttribute("href") === "/admin"),
        ).toBe(true);
        const menu = screen.getByRole("navigation", {
          name: "Account destinations",
        });
        expect(
          links.some(
            (link) =>
              container.querySelector("header")!.contains(link) &&
              !menu.contains(link),
          ),
        ).toBe(true);
      }
      if (area === "tutor" && !allowed) {
        expect(
          screen
            .getByRole("link", { name: "workflows.messages" })
            .getAttribute("href"),
        ).toBe("/messages");
      }
    },
  );
}
it.each([null, { id: "tutor", status: "ARCHIVED" }])(
  "returns a viewer with an unavailable tutor profile to management (%j)",
  async (tutor) => {
    mocks.auth.mockResolvedValue({
      user: { id: "account" },
      role: "VIEWER",
      tutorId: "tutor",
    });
    mocks.tutor.mockResolvedValue(tutor);
    await expect(TutorLayout({ children: null })).rejects.toThrow(
      "redirect:/admin",
    );
  },
);
it("keeps archived pure-tutor history accessible without management access", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "account" },
    role: "TUTOR",
    tutorId: "tutor",
  });
  mocks.tutor.mockResolvedValue({ id: "tutor", status: "ARCHIVED" });
  mocks.user.mockResolvedValue({ emailVerifiedAt: new Date(), role: "TUTOR" });
  render(await TutorLayout({ children: <p>Tutor history</p> }));
  expect(screen.getByText("Tutor history")).toBeTruthy();
  expect(
    screen.queryByRole("link", {
      name: "components.userMenu.backToManagement",
    }),
  ).toBeNull();
});
it.each([null, { status: "ARCHIVED" }])(
  "tutee workspace omits unavailable tutor entry (%j)",
  async (tutor) => {
    mocks.user.mockResolvedValue({ role: "ADMIN", tutor, tuteeMember: true });
    render(await TuteeLayout({ children: null }));
    expect(
      screen.queryByRole("link", { name: "components.userMenu.enterTutor" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("link", {
        name: "components.userMenu.backToManagement",
      }),
    ).toHaveLength(2);
  },
);
