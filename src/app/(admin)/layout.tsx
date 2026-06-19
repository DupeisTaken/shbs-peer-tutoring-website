import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { NavLink } from "~/app/_components/nav-link";
import { SignOutButton } from "~/app/_components/sign-out-button";

const ELEVATED_ROLES = ["ADMIN", "COORDINATOR"];

type NavItem = { href: string; label: string; exact?: boolean; adminOnly?: boolean };

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard", exact: true }],
  },
  {
    title: "People",
    items: [
      { href: "/admin/tutors", label: "Tutors" },
      { href: "/admin/tutees", label: "Tutees" },
    ],
  },
  {
    title: "Scheduling",
    items: [
      { href: "/admin/pairings", label: "Pairings" },
      { href: "/admin/timeslots", label: "Time slots" },
      { href: "/admin/courses", label: "Courses" },
      { href: "/admin/rooms", label: "Rooms" },
    ],
  },
  {
    title: "Records",
    items: [
      { href: "/admin/submissions", label: "Submissions" },
      { href: "/admin/summary", label: "Monthly summary" },
      { href: "/admin/meetings", label: "Meetings" },
      { href: "/admin/adjustments", label: "Adjustments" },
      { href: "/admin/punishments", label: "Punishments" },
    ],
  },
  {
    title: "Administration",
    items: [{ href: "/admin/users", label: "Users & roles", adminOnly: true }],
  },
];

/**
 * Gates the entire admin section. Requires an elevated role (ADMIN or COORDINATOR).
 * Server-enforced; the middleware only checks authentication, not role.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!ELEVATED_ROLES.includes(session.role)) redirect("/");

  const isAdmin = session.role === "ADMIN";
  const visible = (item: NavItem) => !item.adminOnly || isAdmin;

  return (
    <div className="min-h-screen">
      {/* Mobile top bar (sidebar is hidden below lg) */}
      <header className="border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/admin" className="font-bold text-slate-900">
            SHBS Admin
          </Link>
          <SignOutButton className="btn-secondary btn-sm" />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {NAV_SECTIONS.flatMap((s) => s.items)
            .filter(visible)
            .map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-6">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 space-y-6">
            <div className="px-3">
              <Link href="/admin" className="text-lg font-bold text-slate-900">
                SHBS Admin
              </Link>
              <p className="muted mt-0.5 truncate text-xs">
                {session.user.name} · {session.role}
              </p>
            </div>

            <nav className="space-y-5">
              {NAV_SECTIONS.map((section) => {
                const items = section.items.filter(visible);
                if (items.length === 0) return null;
                return (
                  <div key={section.title}>
                    <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      {section.title}
                    </p>
                    <div className="space-y-0.5">
                      {items.map((item) => (
                        <NavLink key={item.href} {...item} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </nav>

            <div className="px-3 pt-2">
              <SignOutButton />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
