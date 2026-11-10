// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LocalizationLayout from "./layout";

const fixture = vi.hoisted(() => ({
  auth: vi.fn(),
  account: vi.fn(),
  recovery: vi.fn(),
  privateEditor: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: fixture.auth }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: fixture.account } },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/app/_components/workspace-header", () => ({
  WorkspaceHeader: ({
    identity,
    navigation,
  }: {
    identity: ReactNode;
    navigation?: ReactNode;
  }) => (
    <header>
      {identity}
      {navigation}
    </header>
  ),
}));
vi.mock("~/app/_components/sign-out-button", () => ({
  SignOutButton: () => null,
}));
vi.mock("~/app/_components/admin-nav", () => ({
  NavSidebar: () => <nav aria-label="Management sidebar" />,
  NavMobileRow: () => <nav aria-label="Mobile management navigation" />,
}));
vi.mock("~/app/_components/translation-intent-recovery", () => ({
  TranslationIntentRecoveryEntry: () => {
    fixture.recovery();
    return <section aria-label="Own receipt recovery" />;
  },
}));

function PrivateEditor() {
  fixture.privateEditor();
  return <p>Private destination editor</p>;
}
beforeEach(() => {
  vi.clearAllMocks();
  // A stale management cookie never grants destination access over the live row.
  fixture.auth.mockResolvedValue({
    user: { id: "original-actor", name: "Synthetic account" },
    role: "ADMIN",
  });
  fixture.account.mockResolvedValue({
    role: "STUDENT",
    canTranslate: false,
    suspendedAt: null,
    tutorId: null,
    tutorAccessRevoked: false,
    tutor: null,
  });
});
afterEach(cleanup);

it("redirects anonymous requests before account lookup or recovery", async () => {
  fixture.auth.mockResolvedValue(null);
  await expect(
    LocalizationLayout({ children: <PrivateEditor /> }),
  ).rejects.toThrow("redirect:/signin");
  expect(fixture.account).not.toHaveBeenCalled();
  expect(fixture.recovery).not.toHaveBeenCalled();
  expect(fixture.privateEditor).not.toHaveBeenCalled();
});

it("redirects a missing live account without mounting either client surface", async () => {
  fixture.account.mockResolvedValue(null);
  await expect(
    LocalizationLayout({ children: <PrivateEditor /> }),
  ).rejects.toThrow("redirect:/signin");
  expect(fixture.account).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "original-actor" } }),
  );
  expect(fixture.recovery).not.toHaveBeenCalled();
  expect(fixture.privateEditor).not.toHaveBeenCalled();
});

it.each([false, true])(
  "preserves the suspension redirect with Translator assignment %s",
  async (canTranslate) => {
    fixture.account.mockResolvedValue({
      role: "STUDENT",
      canTranslate,
      suspendedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(
      LocalizationLayout({ children: <PrivateEditor /> }),
    ).rejects.toThrow("redirect:/suspended");
    expect(fixture.recovery).not.toHaveBeenCalled();
    expect(fixture.privateEditor).not.toHaveBeenCalled();
  },
);

it.each(["STUDENT", "TUTOR", "CREW", "VIEWER"])(
  "mounts only receipt recovery for live %s without Translator access",
  async (role) => {
    fixture.account.mockResolvedValue({
      role,
      canTranslate: false,
      suspendedAt: null,
    });
    render(await LocalizationLayout({ children: <PrivateEditor /> }));
    expect(
      screen.getByRole("region", { name: "Own receipt recovery" }),
    ).toBeTruthy();
    expect(screen.queryByText("Private destination editor")).toBeNull();
    expect(fixture.privateEditor).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "Management sidebar" }),
    ).toBeNull();
    expect(
      screen.queryByRole("navigation", {
        name: "Mobile management navigation",
      }),
    ).toBeNull();
  },
);

it.each(["STUDENT", "TUTOR", "CREW"])(
  "preserves the private editor for assigned live %s",
  async (role) => {
    fixture.account.mockResolvedValue({
      role,
      canTranslate: true,
      suspendedAt: null,
    });
    render(await LocalizationLayout({ children: <PrivateEditor /> }));
    expect(screen.getByText("Private destination editor")).toBeTruthy();
    expect(fixture.recovery).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "Management sidebar" }),
    ).toBeNull();
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "preserves management review admission for live %s without Translator",
  async (role) => {
    fixture.account.mockResolvedValue({
      role,
      canTranslate: false,
      suspendedAt: null,
    });
    render(await LocalizationLayout({ children: <PrivateEditor /> }));
    expect(screen.getByText("Private destination editor")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Management sidebar" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Mobile management navigation" }),
    ).toBeTruthy();
    expect(fixture.recovery).not.toHaveBeenCalled();
  },
);
