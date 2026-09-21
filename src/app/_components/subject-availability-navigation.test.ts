import { expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("./admin-mobile-navigation", () => ({
  AdminMobileNavigation: () => null,
}));
vi.mock("./nav-sidebar-client", () => ({ NavSidebarClient: () => null }));
import { NAV_SECTIONS } from "./admin-nav";
it("places subject availability directly below the roster without an interview feature gate", () => {
  const items = NAV_SECTIONS.flatMap((section) => section.items);
  const roster = items.findIndex((item) => item.href === "/admin/tutors");
  expect(items[roster + 1]).toMatchObject({
    href: "/admin/subject-availability",
    elevatedOnly: true,
  });
  expect(items[roster + 1]?.feature).toBeUndefined();
  expect(items.some((item) => item.href === "/admin/interviews")).toBe(false);
  expect(items.some((item) => item.href === "/admin/applications")).toBe(true);
});
