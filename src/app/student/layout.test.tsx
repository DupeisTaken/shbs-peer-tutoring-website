// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useSyncExternalStore } from "react";
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
  pathname: "/dashboard",
  search: "",
  routeVersion: 0,
  routeListeners: new Set<() => void>(),
  privateChild: vi.fn(),
  navigation: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: mocks.user,
      findUniqueOrThrow: async () => {
        const user = (await mocks.user()) as { role?: string } | null;
        const session = (await mocks.auth()) as { role?: string } | null;
        return { ...user, role: user?.role ?? session?.role };
      },
    },
    tutor: { findUnique: mocks.tutor },
    policyAcceptance: {
      findUnique: mocks.acceptance,
      findFirst: mocks.pastAcceptance,
    },
  },
}));
vi.mock("~/server/policy-acceptance", () => ({
  currentPolicy: mocks.currentPolicy,
  // Layout tests exercise policy-gate rendering; merge-family evidence resolution is
  // covered by the database integration tests. Preserve current-versus-past fixtures.
  findAccountPolicy: (
    _db: unknown,
    _userId: string,
    _slug: string,
    revision?: string,
  ) =>
    (revision
      ? mocks.acceptance()
      : mocks.pastAcceptance()) as Promise<unknown>,
}));
vi.mock("~/app/_components/school-departure", () => ({
  DepartureBanner: () => null,
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
vi.mock("~/app/_components/translation-intent-recovery", () => ({
  TranslationIntentRecoveryEntry: () => <p>Own translation receipt recovery</p>,
}));
function subscribeRoute(listener: () => void) {
  mocks.routeListeners.add(listener);
  return () => {
    mocks.routeListeners.delete(listener);
  };
}
function getRouteVersion() {
  return mocks.routeVersion;
}
vi.mock("next/navigation", () => ({
  usePathname: () => {
    useSyncExternalStore(subscribeRoute, getRouteVersion, getRouteVersion);
    return mocks.pathname;
  },
  useSearchParams: () => {
    useSyncExternalStore(subscribeRoute, getRouteVersion, getRouteVersion);
    return new URLSearchParams(mocks.search);
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: mocks.messages,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
vi.mock("./navigation", () => ({
  TuteeNavigation: () => {
    mocks.navigation();
    return <nav aria-label="Tutee navigation" />;
  },
}));
vi.mock("~/app/_components/account-settings", () => ({
  AccountSettings: ({ embedded }: { embedded?: boolean }) => (
    <section aria-label="Own account controls" data-embedded={embedded} />
  ),
}));
vi.mock("~/app/_components/message-inbox", () => ({
  MessageInbox: () => <section aria-label="Own messages" />,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/dashboard";
  mocks.search = "";
  mocks.routeVersion = 0;
  mocks.routeListeners.clear();
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
it.each(["GRADUATED", "TRANSFERRED"])(
  "offers %s students a viewer entry without requiring new participation consent",
  async (reason) => {
    mocks.auth.mockResolvedValue({
      user: { id: "account" },
      role: "STUDENT",
      tutorId: null,
    });
    mocks.user.mockResolvedValue({
      role: "STUDENT",
      tutor: null,
      tuteeMember: false,
      schoolDeparture: { reason, observerRevoked: false, tutorDerived: false },
    });
    mocks.acceptance.mockResolvedValue(null);
    render(await TuteeLayout({ children: <p>Personal history</p> }));
    expect(screen.getByText("Personal history")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "schoolDeparture.enter" }),
    ).toHaveLength(2);
  },
);
it("admits a departed tutor to read-only management and retains the return link", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "account" },
    role: "TUTOR",
    tutorId: "tutor",
  });
  mocks.user.mockResolvedValue({
    role: "TUTOR",
    tutor: { status: "TRANSFERRED" },
    schoolDeparture: {
      reason: "TRANSFERRED",
      observerRevoked: false,
      tutorDerived: true,
    },
  });
  render(await AdminLayout({ children: <p>Observer content</p> }));
  expect(screen.getByText("admin.readOnly.banner")).toBeTruthy();
  expect(
    screen.getAllByRole("link", { name: "components.userMenu.enterTutor" }),
  ).toHaveLength(2);
});
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
    mocks.user.mockResolvedValue({ role, canTranslate: true });
    render(await LocalizationLayout({ children: null }));
    expect(
      screen.getByRole("navigation", { name: "Mobile management navigation" }),
    ).toBeTruthy();
    expect(screen.getByText(`admin.users.roles.${role}`)).toBeTruthy();
  },
);
// Review access follows the live management rank, while editing remains an explicit badge.
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "admits %s reviewers without explicit Translator membership",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role: "STUDENT" });
    mocks.user.mockResolvedValue({ role, canTranslate: false });
    render(await LocalizationLayout({ children: <p>Translation review</p> }));
    expect(screen.getByText("Translation review")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Mobile management navigation" }),
    ).toBeTruthy();
    expect(screen.getByText(`admin.users.roles.${role}`)).toBeTruthy();
  },
);
it.each(["VIEWER", "STUDENT"])(
  "limits %s without Translator membership to own receipt recovery",
  async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "account" }, role });
    mocks.user.mockResolvedValue({ role, canTranslate: false });
    render(
      await LocalizationLayout({
        children: <p>Private translation workspace</p>,
      }),
    );
    expect(screen.getByText("Own translation receipt recovery")).toBeTruthy();
    expect(screen.queryByText("Private translation workspace")).toBeNull();
  },
);
it("keeps assigned translators focused and redirects suspended translators", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "account" }, role: "STUDENT" });
  mocks.user.mockResolvedValue({ role: "STUDENT", canTranslate: true });
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
      role,
      tutor: { status: "ACTIVE" },
      tuteeMember: false,
    });
    const withoutMembership = render(
      await TuteeLayout({ children: <p>Private tutee content</p> }),
    );
    expect(screen.queryByText("Private tutee content")).toBeNull();
    expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
    withoutMembership.unmount();

    mocks.user.mockResolvedValue({
      role,
      tutor: { status: "ACTIVE" },
      tuteeMember: true,
    });
    mocks.acceptance.mockResolvedValue(null);
    const withoutConsent = render(
      await TuteeLayout({ children: <p>Private tutee content</p> }),
    );
    expect(screen.queryByText("Private tutee content")).toBeNull();
    expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
    withoutConsent.unmount();

    mocks.acceptance.mockResolvedValue({ revision: "published-policy" });
    render(await TuteeLayout({ children: <p>Private tutee content</p> }));
    expect(screen.getByText("Private tutee content")).toBeTruthy();
  },
);

function PrivateStudentContent() {
  mocks.privateChild();
  return <p>Private tutee content</p>;
}
function navigateTo(href: string) {
  const destination = new URL(href, "https://example.test");
  act(() => {
    mocks.pathname = destination.pathname;
    mocks.search = destination.search.slice(1);
    mocks.routeVersion += 1;
    for (const listener of mocks.routeListeners) listener();
  });
}
function followShellLink(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (!href) throw new Error("Expected a shell navigation link");
  link.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      navigateTo(href);
    },
    { once: true },
  );
  fireEvent.click(link);
}
function expectParticipationBlocked() {
  expect(screen.queryByText("Private tutee content")).toBeNull();
  expect(
    screen.queryByRole("navigation", { name: "Tutee navigation" }),
  ).toBeNull();
  expect(mocks.privateChild).not.toHaveBeenCalled();
  expect(mocks.navigation).not.toHaveBeenCalled();
}
for (const view of ["account", "messages"] as const) {
  it.each([
    {
      label: "nonmember Head",
      role: "HEAD",
      tutor: null,
      tuteeMember: false,
    },
    {
      label: "nonmember tutor",
      role: "TUTOR",
      tutor: { status: "ACTIVE" },
      tuteeMember: false,
    },
    {
      label: "nonmember student",
      role: "STUDENT",
      tutor: null,
      tuteeMember: false,
    },
    {
      label: "tutor member without consent",
      role: "TUTOR",
      tutor: { status: "ACTIVE" },
      tuteeMember: true,
    },
  ])(
    `opens direct ${view} for $label without admitting the participation page`,
    async (account) => {
      mocks.pathname = "/student";
      mocks.search = `view=${view}`;
      mocks.user.mockResolvedValue(account);
      mocks.acceptance.mockResolvedValue(null);
      render(await TuteeLayout({ children: <PrivateStudentContent /> }));
      const reader =
        view === "account" ? "Own account controls" : "Own messages";
      expect(screen.getByRole("region", { name: reader })).toBeTruthy();
      if (view === "account")
        expect(
          screen
            .getByRole("region", { name: reader })
            .getAttribute("data-embedded"),
        ).toBe("true");
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.queryByText("workflow.policyTitle")).toBeNull();
      expectParticipationBlocked();
    },
  );
  it(`hydrates a blocked direct ${view} link into its existing personal reader`, async () => {
    mocks.pathname = "/student";
    mocks.search = `view=${view}`;
    mocks.user.mockResolvedValue({
      role: "HEAD",
      tutor: null,
      tuteeMember: false,
    });
    mocks.acceptance.mockResolvedValue(null);
    const layout = await TuteeLayout({ children: <PrivateStudentContent /> });
    const container = document.createElement("div");
    container.innerHTML = renderToString(layout);
    document.body.append(container);
    let hydrated: ReturnType<typeof hydrateRoot> | undefined;
    const onRecoverableError = vi.fn();
    try {
      await act(async () => {
        hydrated = hydrateRoot(container, layout, { onRecoverableError });
      });
      expect(
        screen.getByRole("region", {
          name: view === "account" ? "Own account controls" : "Own messages",
        }),
      ).toBeTruthy();
      expectParticipationBlocked();
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => hydrated?.unmount());
      container.remove();
    }
  });
}
it("follows the rendered identity and account-menu links as the cached layout's URL changes", async () => {
  mocks.pathname = "/student";
  mocks.user.mockResolvedValue({
    name: "Synthetic Head",
    role: "HEAD",
    tutor: null,
    tuteeMember: false,
  });
  mocks.acceptance.mockResolvedValue(null);
  const { container } = render(
    await TuteeLayout({ children: <PrivateStudentContent /> }),
  );
  expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
  const menu = screen.getByRole("navigation", { name: "Account destinations" });
  const identity = [...container.querySelectorAll("header a")].find(
    (link) => !menu.contains(link) && link.textContent === "Synthetic Head",
  );
  expect(identity).toBeTruthy();
  expect(identity!.getAttribute("href")).toBe("/student?view=account");
  followShellLink(identity! as HTMLElement);
  expect(
    screen.getByRole("region", { name: "Own account controls" }),
  ).toBeTruthy();
  expectParticipationBlocked();

  const messages = within(menu).getByRole("link", {
    name: "tuteePortal.messages",
  });
  expect(messages.getAttribute("href")).toBe("/student?view=messages");
  followShellLink(messages);
  expect(screen.getByRole("region", { name: "Own messages" })).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: "Own account controls" }),
  ).toBeNull();
  expectParticipationBlocked();

  followShellLink(
    within(menu).getByRole("link", { name: "tuteePortal.account" }),
  );
  expect(
    screen.getByRole("region", { name: "Own account controls" }),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Own messages" })).toBeNull();
  navigateTo("/student?view=requests");
  expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: "Own account controls" }),
  ).toBeNull();
  expectParticipationBlocked();
});
it.each([
  "/student",
  "/student?view=dashboard",
  "/student?view=schedule",
  "/student?view=requests",
  "/student?view=attendance",
  "/student?view=support",
  "/student?view=unknown",
  "/student?view=Account",
  "/student?view=",
  "/student?view=account&view=messages",
  "/student?view=account&view=account",
  "/student/private?view=account",
])(
  "keeps blocked participation at %s behind the existing notice",
  async (href) => {
    mocks.user.mockResolvedValue({
      role: "HEAD",
      tutor: null,
      tuteeMember: false,
    });
    mocks.acceptance.mockResolvedValue(null);
    navigateTo(href);
    render(await TuteeLayout({ children: <PrivateStudentContent /> }));
    expect(screen.getByText("workflow.policyTitle")).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Own account controls" }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Own messages" })).toBeNull();
    expectParticipationBlocked();
  },
);
it("retains personal access when no policy is published without opening participation views", async () => {
  mocks.pathname = "/student";
  mocks.search = "view=account";
  mocks.user.mockResolvedValue({
    role: "TUTOR",
    tutor: { status: "ACTIVE" },
    tuteeMember: false,
  });
  mocks.currentPolicy.mockResolvedValue(null);
  mocks.acceptance.mockResolvedValue(null);
  render(await TuteeLayout({ children: <PrivateStudentContent /> }));
  expect(
    screen.getByRole("region", { name: "Own account controls" }),
  ).toBeTruthy();
  navigateTo("/student?view=schedule");
  expect(screen.getByText("workflow.policyLoadError")).toBeTruthy();
  expectParticipationBlocked();
});
it.each([
  {
    label: "member",
    role: "STUDENT",
    tutor: null,
    tuteeMember: true,
    schoolDeparture: null,
  },
  {
    label: "tutor with retained consent",
    role: "TUTOR",
    tutor: { status: "ACTIVE" },
    tuteeMember: true,
    schoolDeparture: null,
  },
  {
    label: "departed nonmember",
    role: "STUDENT",
    tutor: null,
    tuteeMember: false,
    schoolDeparture: {
      reason: "GRADUATED",
      observerRevoked: false,
      tutorDerived: false,
    },
  },
])(
  "keeps the existing page and navigation branch for $label on a personal URL",
  async (account) => {
    mocks.pathname = "/student";
    mocks.search = "view=account";
    mocks.user.mockResolvedValue(account);
    mocks.acceptance.mockResolvedValue(null);
    mocks.pastAcceptance.mockResolvedValue({ revision: "retained-policy" });
    render(await TuteeLayout({ children: <PrivateStudentContent /> }));
    expect(screen.getByText("Private tutee content")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Tutee navigation" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Own account controls" }),
    ).toBeNull();
    expect(mocks.privateChild).toHaveBeenCalled();
    navigateTo("/student?view=messages");
    expect(screen.getByText("Private tutee content")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Own messages" })).toBeNull();
  },
);

it.each(["account", "messages"])(
  "redirects a missing database account away from direct %s",
  async (view) => {
    mocks.pathname = "/student";
    mocks.search = `view=${view}`;
    mocks.user.mockResolvedValue(null);
    await expect(
      TuteeLayout({ children: <PrivateStudentContent /> }),
    ).rejects.toThrow("redirect:/signin");
    expect(mocks.currentPolicy).not.toHaveBeenCalled();
    expect(mocks.privateChild).not.toHaveBeenCalled();
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
  it.each(["HEAD", "ADMIN", "COORDINATOR", "TUTOR", "CREW", "STUDENT"])(
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
    mocks.user.mockResolvedValue({ role: "VIEWER" });
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
  expect(document.querySelector('header a[href="/dashboard"]')).toBeTruthy();
  expect(
    screen.queryByRole("navigation", { name: "tutor.navigation.label" }),
  ).toBeNull();
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
