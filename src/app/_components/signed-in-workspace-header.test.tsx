// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

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
vi.mock("./workspace-header", () => ({
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
vi.mock("./user-avatar", () => ({
  UserAvatar: ({
    items,
  }: {
    items: { href: string; label: string; group?: string }[];
  }) => (
    <nav aria-label="Account menu">
      {items.map((item) => (
        <a key={item.href} href={item.href} data-group={item.group}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

import { getSignedInWorkspaceHeader } from "./signed-in-workspace-header";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.features.mockResolvedValue({ CREW: true });
});
afterEach(cleanup);

it("returns null for signed-out, suspended, and merged accounts", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(
    await getSignedInWorkspaceHeader({ href: "/register", title: "Invite" }),
  ).toBeNull();

  const session = { user: { id: "u1" } } as Session;
  mocks.user.mockResolvedValue({
    name: "Suspended",
    email: "s@example.test",
    role: "VIEWER",
    suspendedAt: new Date(),
    mergedIntoId: null,
  });
  expect(
    await getSignedInWorkspaceHeader({
      href: "/register",
      title: "Invite",
      session,
    }),
  ).toBeNull();

  mocks.user.mockResolvedValue({
    name: "Merged",
    email: "m@example.test",
    role: "STUDENT",
    suspendedAt: null,
    mergedIntoId: "other",
  });
  expect(
    await getSignedInWorkspaceHeader({
      href: "/register",
      title: "Invite",
      session,
    }),
  ).toBeNull();
});

it("renders WorkspaceHeader with direct staff destinations and Program Overview for viewers", async () => {
  const session = { user: { id: "u1" } } as Session;
  mocks.user.mockResolvedValue({
    name: "Alex Admin",
    email: "alex@example.test",
    username: "alex",
    role: "ADMIN",
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
  const adminHeader = await getSignedInWorkspaceHeader({
    href: "/register",
    title: "Invitation Code",
    session,
  });
  const { unmount } = render(<>{adminHeader}</>);
  expect(
    document
      .querySelector('[data-header="workspace"]')
      ?.getAttribute("data-title"),
  ).toBe("Invitation Code");
  expect(
    screen.getByRole("link", { name: "workflows.messages" }).getAttribute("href"),
  ).toBe("/admin/messages");
  expect(
    screen.getByRole("link", { name: "workflows.support" }).getAttribute("href"),
  ).toBe("/admin/student-support");
  expect(
    screen.getByRole("link", { name: "account.title" }).getAttribute("href"),
  ).toBe("/admin/account");
  unmount();

  mocks.user.mockResolvedValue({
    name: "Pat Viewer",
    email: "viewer@example.test",
    username: null,
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
  const viewerHeader = await getSignedInWorkspaceHeader({
    href: "/register",
    title: "Invitation Code",
    session,
  });
  render(<>{viewerHeader}</>);
  expect(
    screen
      .getByRole("link", { name: "components.workspaceTitles.viewer" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(
    screen.getByRole("link", { name: "account.title" }).getAttribute("href"),
  ).toBe("/admin/account");
});
