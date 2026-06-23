import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { NotificationBell } from "~/app/_components/notification-bell";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { NavSidebar } from "~/app/_components/admin-nav";
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
    select: { canTranslate: true, tutor: { select: { username: true } } },
  });
  if (!elevated && !me?.canTranslate) redirect("/");

  const t = await getTranslations();
  // Where "home"/back goes: admin-area roles to /admin, a linked tutor to their dashboard.
  const adminArea = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(session.role);
  const home = adminArea ? "/admin" : session.tutorId ? "/dashboard" : "/";

  return (
    <div className="min-h-screen">
      {/* Unified top bar — order: account info · theme · bell · language · buttons */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link href={home} className="text-lg font-bold text-slate-900">
            {TEAM_TITLE}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
              <p className="muted text-xs">
                {me?.tutor?.username ? `@${me.tutor.username} · ` : ""}
                {session.role}
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
      </header>

      {/* Staff get the full admin sidebar; tutor-translators get a focused, sidebar-free page. */}
      {elevated ? (
        <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-6">
          <NavSidebar role={session.role} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">{children}</main>
      )}
    </div>
  );
}
