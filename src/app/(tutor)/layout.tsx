import Link from "next/link";
import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { UserAvatar } from "~/app/_components/user-avatar";
import { APP_TITLE } from "~/lib/branding";

/**
 * Gates the entire tutor section. Requires an authenticated user linked to a Tutor record.
 * Authorization is enforced here on the server (in addition to the middleware and per-procedure
 * checks) — never trust the client. Also enforces first-login onboarding and renders the
 * shared tutor top bar with the user-avatar menu.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/");

  const t = await getTranslations();
  const isElevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";

  // Stale-session guard: `session.tutorId` lives in the JWT and can outlive the Tutor row it
  // points to (e.g. after a dev DB reseed). Tutor queries (`tutor.me`, …) use it and would throw
  // "record not found", 500-ing the whole area. Verify it still resolves first: send an elevated
  // user back to their admin area; ask a pure tutor to sign out so a fresh sign-in re-links them.
  const linkedTutor = await db.tutor.findUnique({
    where: { id: session.tutorId },
    select: { id: true, status: true },
  });
  if (!linkedTutor) {
    if (isElevated) redirect("/admin");
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-sm p-6 text-center">
          <h1 className="section-title">{t("auth.staleSession.title")}</h1>
          <p className="muted mt-2 text-sm">{t("auth.staleSession.body")}</p>
          <div className="mt-4 flex justify-center">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  // Can-tutor permission gate. An ARCHIVED tutor linked to an elevated account means can-tutor was
  // turned off (the link is kept only to preserve the record) — so this account is NOT permitted in
  // the tutor area; send them back to their admin area. (A genuine ARCHIVED *pure* tutor isn't
  // elevated and keeps read-only access to their own history per the lifecycle, so it's unaffected.)
  if (isElevated && linkedTutor.status === "ARCHIVED") redirect("/admin");

  // First-login gate: confirm contact email + set a real password (auto-provisioned
  // accounts arrive on the shared default with mustChangePassword).
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      emailVerifiedAt: true,
      mustChangePassword: true,
      canTranslate: true,
      crewStatus: true,
      tutor: { select: { username: true } },
    },
  });
  if (!me?.emailVerifiedAt || me.mustChangePassword)
    redirect("/onboarding/email");

  const accountItems = [
    ...(isElevated
      ? [
          {
            href: "/admin",
            label: t("components.userMenu.enterAdmin"),
          },
        ]
      : []),
    ...(me.crewStatus === "ACTIVE"
      ? [{ href: "/patrol", label: t("crew.nav.patrol") }]
      : []),
    { href: "/handbook", label: t("tutor.nav.handbook") },
    ...(me.canTranslate
      ? [{ href: "/localization", label: t("localization.navLabel") }]
      : []),
    { href: "/settings", label: t("components.userMenu.settings") },
  ];

  return (
    <div className="min-h-screen">
      {/* Shared top-bar theme with the admin area: brand left, identity + global controls right. */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="grid min-w-0 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-6">
          <Link
            href="/dashboard"
            className="flex min-h-11 max-w-full min-w-0 items-center justify-self-start truncate text-left text-lg font-bold whitespace-nowrap text-slate-900"
          >
            {APP_TITLE}
          </Link>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <Link
              href="/settings"
              className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
              title={t("components.userMenu.settings")}
            >
              <p className="text-sm font-medium text-slate-900">
                {session.user.name}
              </p>
              <p className="muted text-xs">
                {me.tutor?.username ? `@${me.tutor.username}` : session.role}
              </p>
            </Link>
            <div className="shrink-0">
              <ThemeSwitcher compactAtDesktop />
            </div>
            <div className="shrink-0">
              <NotificationBell />
            </div>
            <div className="shrink-0">
              <LanguageSwitcher compactAtDesktop />
            </div>
            <UserAvatar
              name={session.user.name ?? me.email}
              username={me.tutor?.username}
              email={me.email}
              role={session.role}
              items={accountItems}
              compactAtDesktop
            />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
