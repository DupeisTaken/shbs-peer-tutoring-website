import { getTranslations } from "next-intl/server";

import { AdminMobileNavigation } from "~/app/_components/admin-mobile-navigation";
import { NavSidebarClient } from "~/app/_components/nav-sidebar-client";
import { db } from "~/server/db";
import {
  getFeatures,
  type Features,
  type FeatureKey,
} from "~/server/program/features";

export type NavItem = {
  href: string;
  labelKey: string;
  exact?: boolean;
  /** Admin tier only (ADMIN or HEAD). */
  adminOnly?: boolean;
  /** Elevated (HEAD/ADMIN/COORDINATOR) — hidden from the read-only VIEWER. */
  elevatedOnly?: boolean;
  /** Hidden when this optional module is switched off (see /admin/program). */
  feature?: FeatureKey;
};

/** The shared admin navigation, used by the /admin shell and the standalone /localization shell. */
export const NAV_SECTIONS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: "admin.nav.sections.overview",
    items: [
      { href: "/admin", labelKey: "admin.nav.links.dashboard", exact: true },
      { href: "/admin/activity", labelKey: "admin.nav.links.activity" },
      { href: "/admin/history", labelKey: "admin.nav.links.reports" },
      {
        href: "/admin/announcements",
        labelKey: "admin.nav.links.announcements",
      },
    ],
  },
  {
    // Everything tutor-facing.
    titleKey: "admin.nav.sections.tutors",
    items: [
      { href: "/admin/tutors", labelKey: "admin.nav.links.tutorRoster" },
      {
        href: "/admin/applications",
        labelKey: "admin.nav.links.tutorApplications",
      },
      {
        href: "/admin/tutor-requests",
        labelKey: "admin.nav.links.tutorRequests",
        elevatedOnly: true,
      },
      {
        href: "/admin/meetings",
        labelKey: "admin.nav.links.tutorMeetings",
        feature: "MEETINGS",
      },
      {
        href: "/admin/service-hours",
        labelKey: "admin.nav.links.serviceHours",
        feature: "SERVICE_HOURS",
      },
      {
        href: "/admin/hour-adjustments",
        labelKey: "admin.nav.links.hourAdjustments",
        feature: "SERVICE_HOURS",
      },
    ],
  },
  {
    // Everything tutee-facing.
    titleKey: "admin.nav.sections.tutees",
    items: [
      { href: "/admin/tutees", labelKey: "admin.nav.links.tuteeRoster" },
      { href: "/admin/requests", labelKey: "admin.nav.links.signupRequests" },
      {
        href: "/admin/tutee-requests",
        labelKey: "admin.nav.links.tuteeRequests",
        elevatedOnly: true,
      },
      {
        href: "/admin/discipline",
        labelKey: "admin.nav.links.tuteeDiscipline",
        feature: "DISCIPLINE",
      },
    ],
  },
  {
    titleKey: "admin.nav.sections.schedulingRecords",
    items: [
      { href: "/admin/pairings", labelKey: "admin.nav.links.pairings" },
      { href: "/admin/attendance", labelKey: "admin.nav.links.attendance" },
      {
        href: "/admin/session-flags",
        labelKey: "admin.nav.links.sessionFlags",
        elevatedOnly: true,
        feature: "CREW",
      },
      {
        href: "/admin/crew",
        labelKey: "admin.nav.links.crew",
        elevatedOnly: true,
        feature: "CREW",
      },
      { href: "/admin/time-slots", labelKey: "admin.nav.links.timeSlots" },
      { href: "/admin/subjects", labelKey: "admin.nav.links.coursesLevels" },
      { href: "/admin/rooms", labelKey: "admin.nav.links.rooms" },
    ],
  },
  {
    titleKey: "admin.nav.sections.administration",
    items: [
      {
        href: "/admin/program",
        labelKey: "admin.nav.links.program",
        adminOnly: true,
      },
      {
        href: "/admin/landing",
        labelKey: "admin.nav.links.landing",
        elevatedOnly: true,
      },
      { href: "/admin/policies", labelKey: "admin.nav.links.policyDocuments" },
      {
        href: "/localization",
        labelKey: "localization.navLabel",
        elevatedOnly: true,
      },
      {
        href: "/admin/registration-codes",
        labelKey: "admin.nav.links.registrationCodes",
        elevatedOnly: true,
      },
      // Audit Log + Users & Roles stay pinned to the bottom of the section.
      {
        href: "/admin/approvals",
        labelKey: "approvals.title",
        elevatedOnly: true,
      },
      { href: "/admin/audit", labelKey: "admin.nav.links.auditLog" },
      {
        href: "/admin/users",
        labelKey: "admin.nav.links.usersRoles",
        elevatedOnly: true,
      },
    ],
  },
];

function makeVisible(role: string, features: Features) {
  const isAdminTier = role === "ADMIN" || role === "HEAD";
  const isElevated = isAdminTier || role === "COORDINATOR";
  return (item: NavItem) =>
    (!item.adminOnly || isAdminTier) &&
    (!item.elevatedOnly || isElevated) &&
    (!item.feature || features[item.feature]);
}

/** Sticky left sidebar (lg+): collapsible nav groups + a collapse/expand-all toggle, filtered by
 *  role. Labels resolve server-side; the client component owns collapse state (persisted). */
export async function NavSidebar({ role }: { role: string }) {
  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  const visible = makeVisible(role, features);
  const sections = NAV_SECTIONS.map((section) => ({
    key: section.titleKey,
    title: t(section.titleKey),
    items: section.items.filter(visible).map((item) => ({
      href: item.href,
      label: t(item.labelKey),
      exact: item.exact,
    })),
  })).filter((s) => s.items.length > 0);
  return (
    <aside className="hidden min-h-0 w-56 shrink-0 overflow-y-auto overscroll-contain pr-2 lg:block" aria-label={t("adminNavigation.title")}>
      <NavSidebarClient
        sticky={false}
        sections={sections}
        collapseAllLabel={t("common.collapseAll")}
        expandAllLabel={t("common.expandAll")}
      />
    </aside>
  );
}

/** Small screens use a bounded modal drawer with the same role-filtered sections. */
export async function NavMobileRow({ role }: { role: string }) {
  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  const visible = makeVisible(role, features);
  return (
    <AdminMobileNavigation
      sections={NAV_SECTIONS.map(section => ({
        key: section.titleKey,
        title: t(section.titleKey),
        items: section.items.filter(visible).map(item => ({href: item.href, label: t(item.labelKey), exact: item.exact})),
      })).filter(section => section.items.length > 0)}
      labels={{title:t("adminNavigation.title"), open:t("adminNavigation.open"), close:t("common.close"), collapse:t("common.collapseAll"), expand:t("common.expandAll")}}
    />
  );
}
