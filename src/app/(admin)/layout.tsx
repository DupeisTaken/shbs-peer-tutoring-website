import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { NotificationBell } from "~/app/_components/notification-bell";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { UserAvatar } from "~/app/_components/user-avatar";
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

  // Username for the identity block in the top bar (account handle, falling back to a linked
  // tutor's). The block links to the self-service account page. The tutor `status` decides whether
  // to show the "Enter tutor" hop: an ARCHIVED tutor means can-tutor is off (not permitted) — we
  // keep the link to preserve attributes, so check the live status rather than the JWT's tutorId.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      username: true,
      crewStatus: true,
      suspendedAt: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  // A suspended viewer keeps their login but is routed to the suspension/appeal screen.
  if (me?.suspendedAt) redirect("/suspended");
  // Permitted to tutor = a live linked tutor that hasn't been archived (can-tutor turned off).
  // Keyed off the DB link (`me.tutor`), not the JWT's `session.tutorId`, so toggling can-tutor on
  // shows the button on the next render without waiting for a re-login. The jwt callback keeps
  // `session.tutorId` in sync too, so following the link into the tutor area resolves correctly.
  const canEnterTutor = !!me?.tutor && me.tutor.status !== "ARCHIVED";
  const accountItems = [
    ...(canEnterTutor
      ? [
          {
            href: "/dashboard",
            label: t("components.userMenu.enterTutor"),
          },
        ]
      : []),
    ...(me?.crewStatus === "ACTIVE"
      ? [{ href: "/patrol", label: t("crew.nav.patrol") }]
      : []),
    { href: "/admin/account", label: t("account.title") },
  ];

  return (
    <div className="min-h-screen">
      {/* Unified top bar (all breakpoints): brand + the global controls. */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="grid min-w-0 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-6">
          <Link
            href="/admin"
            className="flex min-h-11 max-w-full min-w-0 items-center justify-self-start truncate text-left text-lg font-bold whitespace-nowrap text-slate-900"
          >
            {TEAM_TITLE}
          </Link>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <Link
              href="/admin/account"
              className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
              title={t("account.title")}
            >
              <p className="text-sm font-medium text-slate-900">
                {session.user.name}
              </p>
              <p className="muted text-xs">
                {(me?.username ?? me?.tutor?.username)
                  ? `@${me.username ?? me?.tutor?.username} · `
                  : ""}
                {session.role}
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
              name={session.user.name ?? session.user.email ?? session.role}
              username={me?.username ?? me?.tutor?.username}
              email={session.user.email}
              role={session.role}
              items={accountItems}
              compactAtDesktop
            />
          </div>
        </div>
        <NavMobileRow role={session.role} />
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-5 sm:py-6 lg:px-6">
        <NavSidebar role={session.role} />

        {/* Main content. `data-readonly` exposes the read-only VIEWER role to globals.css, which keeps
            only a thin destructive-control backstop; mutation panels are hidden per-page via
            useReadOnly(), and the server-side adminProcedure checks are the real guard. */}
        <main
          className="min-w-0 flex-1"
          data-readonly={readOnly ? "" : undefined}
        >
          {readOnly && (
            // Viewer's viewing pass — a welcoming accent strip, not an amber lockout warning
            // (the program values transparency). The eye glyph carries the "viewer" identity, so
            // the copy stays the single existing banner string.
            <div className="border-accent-200 bg-accent-50 mb-5 flex items-center gap-3 rounded-xl border px-4 py-2.5">
              <span
                aria-hidden
                className="bg-accent-100 text-accent-700 ring-accent-200 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              </span>
              <p className="text-accent-800 text-sm leading-snug">
                {t("admin.readOnly.banner")}
              </p>
            </div>
          )}
          <ReadOnlyProvider value={readOnly}>{children}</ReadOnlyProvider>
        </main>
      </div>
    </div>
  );
}
