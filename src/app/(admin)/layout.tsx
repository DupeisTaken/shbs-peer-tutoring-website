import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { NavSidebar, NavMobileRow } from "~/app/_components/admin-nav";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { TEAM_TITLE } from "~/lib/branding";

// Roles allowed into the /admin area. VIEWER is read-only (see viewerProcedure + PII masking).
// HEAD outranks ADMIN and shares the same admin-area access.
const ADMIN_AREA_ROLES = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"];

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

  const readOnly = session.role === "VIEWER";

  // Username (if this admin is also a linked tutor) for the identity block in the top bar.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { tutor: { select: { username: true } } },
  });

  return (
    <div className="min-h-screen">
      {/* Unified top bar (all breakpoints): brand + the global controls. */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link href="/admin" className="text-lg font-bold text-slate-900">
            {TEAM_TITLE}
          </Link>
          {/* Order: account info · theme · bell · language · buttons */}
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
            {session.tutorId && (
              <Link href="/dashboard" className="btn-secondary btn-sm">
                {t("components.userMenu.enterTutor")}
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
        <NavMobileRow role={session.role} />
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-6">
        <NavSidebar role={session.role} />

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
