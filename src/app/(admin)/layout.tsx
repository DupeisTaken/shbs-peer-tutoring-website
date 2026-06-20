import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { NavLink } from "~/app/_components/nav-link";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { UserAvatar } from "~/app/_components/user-avatar";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { TEAM_TITLE } from "~/lib/branding";

const ELEVATED_ROLES = ["ADMIN", "COORDINATOR"];

type NavItem = { href: string; labelKey: string; exact?: boolean; adminOnly?: boolean };

const NAV_SECTIONS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "admin.nav.sections.overview",
    items: [
      { href: "/admin", labelKey: "admin.nav.links.dashboard", exact: true },
      { href: "/admin/activity", labelKey: "admin.nav.links.activity" },
      { href: "/admin/announcements", labelKey: "admin.nav.links.announcements" },
    ],
  },
  {
    // Everything tutor-facing.
    titleKey: "admin.nav.sections.tutors",
    items: [
      { href: "/admin/tutors", labelKey: "admin.nav.links.tutorRoster" },
      { href: "/admin/applications", labelKey: "admin.nav.links.tutorApplications" },
      { href: "/admin/meetings", labelKey: "admin.nav.links.tutorMeetings" },
      { href: "/admin/summary", labelKey: "admin.nav.links.serviceHours" },
      { href: "/admin/adjustments", labelKey: "admin.nav.links.hourAdjustments" },
    ],
  },
  {
    // Everything tutee-facing.
    titleKey: "admin.nav.sections.tutees",
    items: [
      { href: "/admin/tutees", labelKey: "admin.nav.links.tuteeRoster" },
      { href: "/admin/requests", labelKey: "admin.nav.links.signupRequests" },
      { href: "/admin/cards", labelKey: "admin.nav.links.tuteeDiscipline" },
    ],
  },
  {
    titleKey: "admin.nav.sections.schedulingRecords",
    items: [
      { href: "/admin/pairings", labelKey: "admin.nav.links.pairings" },
      { href: "/admin/submissions", labelKey: "admin.nav.links.attendance" },
      { href: "/admin/timeslots", labelKey: "admin.nav.links.timeSlots" },
      { href: "/admin/courses", labelKey: "admin.nav.links.coursesLevels" },
      { href: "/admin/rooms", labelKey: "admin.nav.links.rooms" },
    ],
  },
  {
    titleKey: "admin.nav.sections.administration",
    items: [
      { href: "/admin/policies", labelKey: "admin.nav.links.policyDocuments" },
      { href: "/admin/audit", labelKey: "admin.nav.links.auditLog" },
      { href: "/admin/users", labelKey: "admin.nav.links.usersRoles", adminOnly: true },
    ],
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
  const t = await getTranslations();

  if (!session?.user) redirect("/signin");
  if (!ELEVATED_ROLES.includes(session.role)) redirect("/");

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, tutor: { select: { username: true } } },
  });

  const isAdmin = session.role === "ADMIN";
  const visible = (item: NavItem) => !item.adminOnly || isAdmin;

  return (
    <div className="min-h-screen">
      {/* Mobile top bar (sidebar is hidden below lg) */}
      <header className="border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/admin" className="font-bold text-slate-900">
            {TEAM_TITLE}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <NotificationBell />
            <UserAvatar
              name={session.user.name ?? "User"}
              username={me?.tutor?.username}
              email={me?.email}
              role={session.role}
            />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {NAV_SECTIONS.flatMap((s) => s.items)
            .filter(visible)
            .map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={t(item.labelKey)}
                exact={item.exact}
              />
            ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-6">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 space-y-6">
            <div className="px-3">
              <div className="flex items-center justify-between gap-2">
                <Link href="/admin" className="text-lg font-bold text-slate-900">
                  {TEAM_TITLE}
                </Link>
                <NotificationBell />
              </div>
              <p className="muted mt-0.5 truncate text-xs">
                {session.user.name} · {session.role}
              </p>
            </div>

            <nav className="space-y-5">
              {NAV_SECTIONS.map((section) => {
                const items = section.items.filter(visible);
                if (items.length === 0) return null;
                return (
                  <div key={section.titleKey}>
                    <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      {t(section.titleKey)}
                    </p>
                    <div className="space-y-0.5">
                      {items.map((item) => (
                        <NavLink
                          key={item.href}
                          href={item.href}
                          label={t(item.labelKey)}
                          exact={item.exact}
                        />
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
