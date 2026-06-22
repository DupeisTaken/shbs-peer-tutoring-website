import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { NavLink } from "~/app/_components/nav-link";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { TEAM_TITLE } from "~/lib/branding";

// Roles allowed into the /admin area. VIEWER is read-only (see viewerProcedure + PII masking).
const ADMIN_AREA_ROLES = ["ADMIN", "COORDINATOR", "VIEWER"];

type NavItem = { href: string; labelKey: string; exact?: boolean; adminOnly?: boolean };

const NAV_SECTIONS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "admin.nav.sections.overview",
    items: [
      { href: "/admin", labelKey: "admin.nav.links.dashboard", exact: true },
      { href: "/admin/activity", labelKey: "admin.nav.links.activity" },
      { href: "/admin/history", labelKey: "admin.nav.links.history" },
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
      { href: "/admin/service-hours", labelKey: "admin.nav.links.serviceHours" },
      { href: "/admin/hour-adjustments", labelKey: "admin.nav.links.hourAdjustments" },
    ],
  },
  {
    // Everything tutee-facing.
    titleKey: "admin.nav.sections.tutees",
    items: [
      { href: "/admin/tutees", labelKey: "admin.nav.links.tuteeRoster" },
      { href: "/admin/requests", labelKey: "admin.nav.links.signupRequests" },
      { href: "/admin/discipline", labelKey: "admin.nav.links.tuteeDiscipline" },
    ],
  },
  {
    titleKey: "admin.nav.sections.schedulingRecords",
    items: [
      { href: "/admin/pairings", labelKey: "admin.nav.links.pairings" },
      { href: "/admin/attendance", labelKey: "admin.nav.links.attendance" },
      { href: "/admin/time-slots", labelKey: "admin.nav.links.timeSlots" },
      { href: "/admin/subjects", labelKey: "admin.nav.links.coursesLevels" },
      { href: "/admin/rooms", labelKey: "admin.nav.links.rooms" },
    ],
  },
  {
    titleKey: "admin.nav.sections.administration",
    items: [
      { href: "/admin/program", labelKey: "admin.nav.links.program", adminOnly: true },
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
  if (!ADMIN_AREA_ROLES.includes(session.role)) redirect("/");

  const isAdmin = session.role === "ADMIN";
  const readOnly = session.role === "VIEWER";
  const visible = (item: NavItem) => !item.adminOnly || isAdmin;

  // Username (if this admin is also a linked tutor) for the identity block in the top bar.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { tutor: { select: { username: true } } },
  });

  return (
    <div className="min-h-screen">
      {/* Unified top bar (all breakpoints): brand + the global controls. */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link href="/admin" className="text-lg font-bold text-slate-900">
            {TEAM_TITLE}
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
              <p className="muted text-xs">
                {me?.tutor?.username ? `@${me.tutor.username} · ` : ""}
                {session.role}
              </p>
            </div>
            <LanguageSwitcher />
            {session.tutorId && (
              <Link href="/dashboard" className="btn-secondary btn-sm">
                {t("components.userMenu.enterTutor")}
              </Link>
            )}
            <NotificationBell />
            <SignOutButton />
          </div>
        </div>
        {/* Mobile nav row (sidebar is hidden below lg) */}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
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
        {/* Sidebar (navigation only — global controls live in the top bar) */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-5">
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
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {readOnly && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {t("admin.readOnly.banner")}
            </div>
          )}
          <ReadOnlyProvider value={readOnly}>{children}</ReadOnlyProvider>
        </main>
      </div>
    </div>
  );
}
