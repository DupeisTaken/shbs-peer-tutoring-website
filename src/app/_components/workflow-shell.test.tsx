// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "VIEWER",
  tutor: null as null | { status: string },
  revoked: false,
  departure: null as null | {
    reason: string;
    observerRevoked: boolean;
    tutorDerived: boolean;
  },
  signedIn: true,
  exists: true,
  suspended: false,
}));
vi.mock("~/server/auth", () => ({
  auth: async () => (state.signedIn ? { user: { id: "account" } } : null),
}));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ CREW: true }),
}));
vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: async () =>
        state.exists
          ? {
              name: "Person",
              username: "person",
              email: "person@example.test",
              role: state.role,
              suspendedAt: state.suspended ? new Date() : null,
              tutor: state.tutor,
              tutorAccessRevoked: state.revoked,
              schoolDeparture: state.departure,
            }
          : null,
    },
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/messages",
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock("./help-link", () => ({ HelpLink: () => null }));
vi.mock("./notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("./language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("./sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("./theme-switcher", () => ({ ThemeSwitcher: () => null }));
const avatarCalls = vi.hoisted(
  () => [] as { items?: { href: string; label: string }[] }[],
);
vi.mock("./user-avatar", () => ({
  UserAvatar: async (props: { items?: { href: string; label: string }[] }) => {
    avatarCalls.push(props);
    return <button aria-label="Account menu">Avatar</button>;
  },
}));
import { WorkflowShell } from "./workflow-shell";

afterEach(cleanup);
beforeEach(() => {
  avatarCalls.length = 0;
  state.role = "VIEWER";
  state.tutor = null;
  state.revoked = false;
  state.departure = null;
  state.signedIn = true;
  state.exists = true;
  state.suspended = false;
});
it.each(["VIEWER", "HEAD", "ADMIN", "COORDINATOR", "TUTOR", "STUDENT", "CREW"])(
  "only offers reachable tutee onboarding from the %s workflow shell",
  async (role) => {
    state.role = role;
    render(
      await WorkflowShell({ title: "Messages", children: <div>Inbox</div> }),
    );
    const tuteeLink = screen.queryByRole("link", {
      name: "components.workspaceTitles.tutee",
    });
    if (role === "VIEWER") expect(tuteeLink).toBeNull();
    else expect(tuteeLink?.getAttribute("href")).toBe("/student");
    expect(
      screen.getByRole("link", { name: "workflows.settings" }).getAttribute("href"),
    ).toBe("/my-account");
  },
);

it.each([
  ["TUTOR", "ACTIVE", false, true],
  ["TUTOR", "ARCHIVED", false, true],
  ["HEAD", "ARCHIVED", false, false],
  ["VIEWER", "ARCHIVED", false, false],
  ["ADMIN", "ACTIVE", true, false],
  ["STUDENT", "ACTIVE", false, true],
] as const)(
  "uses linked tutor facts for %s/%s (revoked=%s)",
  async (role, status, revoked, expected) => {
    state.role = role;
    state.tutor = { status };
    state.revoked = revoked;
    const view = render(
      await WorkflowShell({ title: "Messages", children: <div>Inbox</div> }),
    );
    expect(
      !!screen.queryByRole("link", { name: "components.workspaceTitles.tutor" }),
    ).toBe(expected);
    expect(
      screen.getAllByRole("button", { name: "Account menu" }),
    ).toHaveLength(1);
    expect(view.container.querySelector("main")?.className).toContain(
      "max-w-5xl",
    );
  },
);

it("provides the read-only Program Overview entry for a departed observer", async () => {
  state.role = "STUDENT";
  state.departure = {
    reason: "Graduated",
    observerRevoked: false,
    tutorDerived: false,
  };
  render(
    await WorkflowShell({ title: "Account", children: <div>Own account</div> }),
  );
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.viewer" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.tutee" })
      .getAttribute("href"),
  ).toBe("/student");
});

it("keeps Account Settings and Tutor Settings distinctly labeled in UserAvatar without duplicating header or tab links", async () => {
  state.role = "ADMIN";
  state.tutor = { status: "ACTIVE" };
  render(
    await WorkflowShell({ title: "Account", children: <div>Own account</div> }),
  );
  const items = avatarCalls.at(-1)?.items ?? [];
  expect(items).toEqual([
    { href: "/my-account", label: "workflows.settings", group: "account" },
    { href: "/settings", label: "account.tutorSettings", group: "account" },
  ]);
});

it.each(["signedOut", "absent", "suspended", "managementDenied"])(
  "preserves the %s guard",
  async (kind) => {
    state.signedIn = kind !== "signedOut";
    state.exists = kind !== "absent";
    state.suspended = kind === "suspended";
    await expect(
      WorkflowShell({
        title: "Account",
        management: kind === "managementDenied",
        children: null,
      }),
    ).rejects.toThrow(
      kind === "suspended"
        ? "/suspended"
        : kind === "managementDenied"
          ? "/"
          : "/signin",
    );
  },
);
