// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  user: vi.fn(),
  features: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.user } } }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("~/app/_components/public-header", () => ({
  PublicHeader: ({
    href = "/",
    title,
    navigation,
  }: {
    href?: string;
    title?: string;
    navigation?: React.ReactNode;
  }) => (
    <header data-header="public">
      <a href={href}>{title}</a>
      {navigation}
    </header>
  ),
}));
vi.mock("~/app/_components/workspace-header", () => ({
  WorkspaceHeader: ({
    href,
    title,
    switcherItems = [],
    account,
  }: {
    href: string;
    title: string;
    switcherItems?: { id: string; href: string; label: string }[];
    account: React.ReactNode;
  }) => (
    <header data-header="workspace" data-home={href} data-title={title}>
      <nav aria-label="Workspace switcher">
        {switcherItems.map((item) => (
          <a key={item.id} href={item.href} data-area={item.id}>
            {item.label}
          </a>
        ))}
      </nav>
      {account}
    </header>
  ),
}));
vi.mock("~/app/_components/user-avatar", () => ({
  UserAvatar: ({ items }: { items: { href: string; label: string; group?: string }[] }) => (
    <nav aria-label="Account menu">
      {items.map((item) => (
        <a key={item.href} href={item.href} data-group={item.group}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

import HelpLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.features.mockResolvedValue({ CREW: true });
});
afterEach(cleanup);

it("uses PublicHeader for visitors and suspended accounts", async () => {
  mocks.auth.mockResolvedValue(null);
  const { unmount } = render(await HelpLayout({ children: <p>Content</p> }));
  expect(
    document.querySelector('[data-header="public"]'),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "helpNav.title" }).getAttribute("href"),
  ).toBe("/");
  expect(
    screen.queryByRole("link", { name: "common.backToMain" }),
  ).toBeNull();
  unmount();

  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.user.mockResolvedValue({
    name: "Suspended",
    email: "s@example.test",
    role: "ADMIN",
    suspendedAt: new Date(),
  });
  render(await HelpLayout({ children: <p>Content</p> }));
  expect(document.querySelector('[data-header="public"]')).toBeTruthy();
  expect(document.querySelector('[data-header="workspace"]')).toBeNull();
});

it("uses WorkspaceHeader with access-gated switcher items and omits Help Center itself", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.user.mockResolvedValue({
    name: "Alex Admin",
    email: "alex@example.test",
    username: "alex",
    role: "ADMIN",
    crewStatus: "ACTIVE",
    tuteeMember: true,
    studentId: null,
    tutorAccessRevoked: false,
    canTranslate: true,
    suspendedAt: null,
    mergedIntoId: null,
    schoolDeparture: null,
    tutor: { username: "alex", status: "ACTIVE" },
  });
  render(await HelpLayout({ children: <p>Guide content</p> }));
  const header = document.querySelector('[data-header="workspace"]');
  expect(header).toBeTruthy();
  expect(header?.getAttribute("data-home")).toBe("/help");
  expect(header?.getAttribute("data-title")).toBe("helpNav.title");
  // Authorized workspaces + Program Home appear in the switcher, while Help Center itself is omitted.
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.management" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.tutor" })
      .getAttribute("href"),
  ).toBe("/dashboard");
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.patrol" })
      .getAttribute("href"),
  ).toBe("/patrol");
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.programHome" })
      .getAttribute("href"),
  ).toBe("/");
  expect(document.querySelector('[data-area="help"]')).toBeNull();
});

it("shows Program Overview instead of Management for Viewer accounts on Help Center", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "v1" } });
  mocks.user.mockResolvedValue({
    name: "Pat Viewer",
    email: "viewer@example.test",
    username: "viewer",
    role: "VIEWER",
    crewStatus: null,
    tuteeMember: false,
    studentId: null,
    tutorAccessRevoked: false,
    canTranslate: false,
    suspendedAt: null,
    mergedIntoId: null,
    schoolDeparture: null,
    tutor: null,
  });
  render(await HelpLayout({ children: <p>Guide content</p> }));
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.viewer" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(
    screen.queryByRole("link", { name: "components.workspaceTitles.management" }),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "components.workspaceTitles.tutor" }),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "components.workspaceTitles.tutee" }),
  ).toBeNull();
});
