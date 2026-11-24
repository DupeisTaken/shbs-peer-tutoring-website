import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  findUser: vi.fn(),
  features: vi.fn(),
  avatarProps: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/portal-access", () => ({ accountPortalAccess: mocks.access }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.findUser } },
}));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/app/_components/user-avatar", () => ({
  UserAvatar: (props: Record<string, unknown>) => {
    mocks.avatarProps = props;
    return null;
  },
}));
vi.mock("~/app/_components/workspace-header", () => ({
  WorkspaceHeader: ({ account }: { account: ReactElement }) => account,
}));
vi.mock("~/app/_components/admin-nav", () => ({
  NavSidebar: () => null,
  NavMobileRow: () => null,
}));
vi.mock("~/app/_components/read-only", () => ({
  ReadOnlyProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("~/app/_components/dismissible-notice", () => ({
  AdminPreferenceIdentity: ({ children }: { children: unknown }) => children,
}));

import AdminLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.avatarProps = null;
  mocks.auth.mockResolvedValue({
    user: { id: "admin-1", name: "Old Name", email: "old@example.test" },
    role: "ADMIN",
  });
  mocks.access.mockResolvedValue({
    canReadManagement: true,
    managementReadOnly: false,
    departed: false,
  });
  mocks.findUser.mockResolvedValue({
    name: "New Name",
    email: "new@example.test",
    username: "admin1",
    crewStatus: null,
    tutorAccessRevoked: false,
    suspendedAt: null,
    tutor: null,
  });
  mocks.features.mockResolvedValue({ CREW: false });
});

it("passes live database primary email and name to UserAvatar even when session claims are stale", async () => {
  const tree = (await AdminLayout({ children: null })) as ReactElement<{
    children: ReactElement[];
  }>;
  const header = tree.props.children[0] as ReactElement<{
    account: ReactElement<{ email?: string; name?: string }>;
  }>;
  expect(header.props.account.props.email).toBe("new@example.test");
  expect(header.props.account.props.name).toBe("New Name");
});
