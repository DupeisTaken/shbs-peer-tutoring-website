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
  expect(screen.getByText("Tutee")).toBeTruthy();
  expect(screen.queryByText("STUDENT")).toBeNull();
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
  expect(
    screen.getByRole("link", { name: "Add Access" }).getAttribute("href"),
  ).toBe("/register");
  // Deduplicates by href while preserving the first label.
  expect(screen.getAllByRole("link", { name: /History/ })).toHaveLength(1);
  // Help Center now lives directly in the shared header bar, not inside the avatar menu.
  expect(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/help"),
  ).toBe(false);
});
