// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

const LABELS: Record<string, string> = {
  "admin.users.roles.STUDENT": "Tutee",
  "account.title": "Account",
  "components.userMenu.groups.workspaces": "Workspaces",
  "components.userMenu.groups.tools": "Tools",
  "components.userMenu.groups.account": "Account",
  "tuteeHistory.myHistory": "My Tutoring History",
  "accountInvitation.addAccess": "Add Access",
};

vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => LABELS[key] ?? key, {
      has: (key: string) => key in LABELS,
    }),
}));
vi.mock("./sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("./details-auto-close", () => ({ DetailsAutoClose: () => null }));

afterEach(cleanup);

it("renders the visible Tutee label while retaining the existing role identifier", async () => {
  render(await UserAvatar({ name: "Alex", role: "STUDENT" }));
  expect(screen.getAllByText("Tutee").length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText("STUDENT")).toBeNull();
});

it("uses a text-only trigger on desktop and retains the circular initials avatar on mobile", async () => {
  const { container } = render(
    await UserAvatar({
      name: "Admin User",
      username: "admin",
      email: "admin@example.edu",
      role: "HEAD",
      roleLabel: "Crew",
    }),
  );
  const summary = container.querySelector("summary");
  expect(summary).toBeTruthy();

  // Mobile circular initials badge is hidden at lg+.
  const mobileAvatar = summary!.querySelector("span.rounded-full");
  expect(mobileAvatar?.textContent).toBe("AU");
  expect(mobileAvatar?.className).toContain("lg:hidden");

  // Desktop trigger shows the two-line account identity + chevron (hidden below lg).
  const desktopIdentity = summary!.querySelector("span.hidden.lg\\:block");
  expect(desktopIdentity?.textContent).toContain("Admin User");
  expect(desktopIdentity?.textContent).toContain("@admin · Crew");
  const chevron = summary!.querySelector("svg");
  expect(chevron?.getAttribute("class")).toContain("hidden");
  expect(chevron?.getAttribute("class")).toContain("lg:block");
});

it("groups links into Workspaces, Tools and Account and keeps Help in the header instead", async () => {
  render(
    await UserAvatar({
      name: "Alex Chen",
      role: "ADMIN",
      items: [
        { href: "/dashboard", label: "Enter Tutor Page", group: "workspaces" },
        { href: "/student", label: "Enter Tutee Page", group: "workspaces" },
        { href: "/admin/messages", label: "Messages", group: "tools" },
        { href: "/admin/account", label: "Account Settings", group: "account" },
        { href: "/history", label: "Duplicate History", group: "account" },
      ],
    }),
  );
  expect(screen.getByText("Workspaces")).toBeTruthy();
  expect(screen.getByText("Tools")).toBeTruthy();
  expect(screen.getByText("Account")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Enter Tutor Page" }).getAttribute("href"),
  ).toBe("/dashboard");
  expect(
    screen.getByRole("link", { name: "Messages" }).getAttribute("href"),
  ).toBe("/admin/messages");
  // Invitation redemption lives in Account Settings rather than cluttering the avatar menu.
  expect(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/register"),
  ).toBe(false);
  // Deduplicates by href while preserving the first label.
  expect(screen.getAllByRole("link", { name: /History/ })).toHaveLength(1);
  // Help Center now lives directly in the shared header bar, not inside the avatar menu.
  expect(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/help"),
  ).toBe(false);
});
