import { getTranslations } from "next-intl/server";

import { NavLink } from "~/app/_components/nav-link";

export type NavItem = {
  href: string;
  labelKey: string;
  exact?: boolean;
  /** Admin tier only (ADMIN or HEAD). */
  adminOnly?: boolean;
  /** Elevated (HEAD/ADMIN/COORDINATOR) — hidden from the read-only VIEWER. */
  elevatedOnly?: boolean;
};

/** The shared admin navigation, used by the /admin shell and the standalone /localization shell. */
export const NAV_SECTIONS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "admin.nav.sections.overview",
    items: [
      { href: "/admin", labelKey: "admin.nav.links.dashboard", exact: true },
      { href: "/admin/activity", labelKey: "admin.nav.links.activity" },
      { href: "/admin/history", labelKey: "admin.nav.links.reports" },
      { href: "/admin/announcements", labelKey: "admin.nav.links.announcements" },
    ],
  },
  {
    // Everything tutor-facing.
    titleKey: "admin.nav.sections.tutors",
    items: [
      { href: "/admin/tutors", labelKey: "admin.nav.links.tutorRoster" },
      { href: "/admin/applications", labelKey: "admin.nav.links.tutorApplications" },
      { href: "/admin/tutor-requests", labelKey: "admin.nav.links.tutorRequests", elevatedOnly: true },
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
      { href: "/admin/tutee-requests", labelKey: "admin.nav.links.tuteeRequests", elevatedOnly: true },
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
      { href: "/localization", labelKey: "localization.navLabel", elevatedOnly: true },
      { href: "/admin/registration-codes", labelKey: "admin.nav.links.registrationCodes", elevatedOnly: true },
      // Audit Log + Users & Roles stay pinned to the bottom of the section.
      { href: "/admin/audit", labelKey: "admin.nav.links.auditLog" },
      { href: "/admin/users", labelKey: "admin.nav.links.usersRoles", elevatedOnly: true },
    ],
  },
];

function makeVisible(role: string) {
  const isAdminTier = role === "ADMIN" || role === "HEAD";
  const isElevated = isAdminTier || role === "COORDINATOR";
  return (item: NavItem) =>
    (!item.adminOnly || isAdminTier) && (!item.elevatedOnly || isElevated);
}

/** Sticky left sidebar (lg+) listing the nav, grouped by section and filtered by role. */
export async function NavSidebar({ role }: { role: string }) {
  const t = await getTranslations();
  const visible = makeVisible(role);
  return (
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
                  <NavLink key={item.href} href={item.href} label={t(item.labelKey)} exact={item.exact} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

/** Horizontally-scrolling nav row shown below the top bar on small screens. */
export async function NavMobileRow({ role }: { role: string }) {
  const t = await getTranslations();
  const visible = makeVisible(role);
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
      {NAV_SECTIONS.flatMap((s) => s.items)
        .filter(visible)
        .map((item) => (
          <NavLink key={item.href} href={item.href} label={t(item.labelKey)} exact={item.exact} />
        ))}
    </nav>
  );
}
