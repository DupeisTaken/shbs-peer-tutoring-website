import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { NotificationBell } from "~/app/_components/notification-bell";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { NavSidebar, NavMobileRow } from "~/app/_components/admin-nav";
import { TEAM_TITLE } from "~/lib/branding";

/**
 * Standalone localization area, reachable by translators from either the admin or tutor side.
 * Server-gated: admins/coordinators, or any user an admin flagged `canTranslate`. Shares the
 * unified top bar; staff get the admin sidebar, tutor-translators get a focused sidebar-free page.
 */
export default async function LocalizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const elevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      canTranslate: true,
      suspendedAt: true,
      tutor: { select: { username: true } },
    },
  });
  if (me?.suspendedAt) redirect("/suspended");
  if (!elevated && !me?.canTranslate) redirect("/");

  const t = await getTranslations();
  // Where "home"/back goes: admin-area roles to /admin, a linked tutor to their dashboard.
  const adminArea = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(
    session.role,
  );
  const home = adminArea ? "/admin" : session.tutorId ? "/dashboard" : "/";

  return (
    <div
      className={
        elevated
          ? "admin-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
          : "min-h-screen"
      }
    >
      {/* Unified top bar — order: account info · theme · bell · language · buttons */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link href={home} className="text-lg font-bold text-slate-900">
            {TEAM_TITLE}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">
                {session.user.name}
              </p>
              <p className="muted text-xs">
                {me?.tutor?.username ? `@${me.tutor.username} · ` : ""}
                {t(`admin.users.roles.${session.role}`)}
              </p>
            </div>
            <ThemeSwitcher />
            <NotificationBell />
            <LanguageSwitcher />
            {/* Sidebar-less views (tutor/viewer translators) get an explicit way back. */}
            {!elevated && (
              <Link href={home} className="btn-secondary btn-sm">
                {t("localization.back")}
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
        {/* Translators keep a focused page; management retains desktop and mobile navigation. */}
        {elevated && <NavMobileRow role={session.role} />}
      </header>

      {/* Staff get the full admin sidebar; tutor-translators get a focused, sidebar-free page. */}
      {elevated ? (
        <div className="admin-workspace mx-auto flex w-full max-w-7xl gap-6 px-4 py-5 sm:py-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:px-6">
          <NavSidebar role={session.role} />
          <main
            id="admin-content"
            tabIndex={0}
            className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 lg:overflow-y-auto lg:overscroll-contain lg:pr-3"
          >
            {children}
          </main>
        </div>
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">{children}</main>
      )}
    </div>
  );
}
