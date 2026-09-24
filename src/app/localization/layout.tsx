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
import { translationAccess } from "~/lib/translation-access";

/**
 * The integrated editor admits assigned translators and management reviewers separately.
 * Read the live account so revoked privileges never survive in a stale session cookie.
 */
export default async function LocalizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      canTranslate: true,
      role: true,
      tutorId: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      tutor: { select: { username: true } },
    },
  });
  if (!me) redirect("/signin");
  if (me.suspendedAt) redirect("/suspended");
  const access = translationAccess(me);
  if (!access.enter) redirect("/");
  const elevated = access.publish || access.request;

  const t = await getTranslations();
  // Where "home"/back goes: admin-area roles to /admin, a linked tutor to their dashboard.
  const adminArea = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(
    me.role,
  );
  const home = adminArea
    ? "/admin"
    : me.tutorId && !me.tutorAccessRevoked
      ? "/dashboard"
      : "/";

  return (
    <div
      className={
        elevated
          ? "admin-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
          : "min-h-screen"
      }
    >
      {/* Mobile rows keep brand/language first, navigation/account second, and return last. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link
            href={home}
            className="text-xl font-bold text-slate-900 lg:text-lg"
          >
            {TEAM_TITLE}
          </Link>
          <div className="ml-auto lg:order-3 lg:ml-0">
            <LanguageSwitcher compactAtDesktop />
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:gap-3 lg:order-2 lg:ml-auto lg:w-auto">
            {elevated && (
              <div className="mr-auto lg:hidden">
                <NavMobileRow role={me.role} embedded />
              </div>
            )}
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">
                {session.user.name}
              </p>
              <p className="muted text-xs">
                {me?.tutor?.username ? `@${me.tutor.username} · ` : ""}
                {t(`admin.users.roles.${me.role}`)}
              </p>
            </div>
            <ThemeSwitcher />
            <NotificationBell />
            <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
          </div>
          {!elevated && (
            <div className="w-full border-t border-slate-200 pt-3 lg:order-4 lg:w-auto lg:border-0 lg:pt-0">
              <Link
                href={home}
                className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0"
              >
                {t("localization.back")}
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Staff get the full admin sidebar; tutor-translators get a focused, sidebar-free page. */}
      {elevated ? (
        <div className="admin-workspace mx-auto flex w-full max-w-7xl gap-6 px-4 py-5 sm:py-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:px-6">
          <NavSidebar role={me.role} />
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
