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

  // Username for the identity block in the top bar (account handle, falling back to a linked
  // tutor's). The block links to the self-service account page. The tutor `status` decides whether
  // to show the "Enter tutor" hop: an ARCHIVED tutor means can-tutor is off (not permitted) — we
  // keep the link to preserve attributes, so check the live status rather than the JWT's tutorId.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, crewStatus: true, suspendedAt: true, tutor: { select: { username: true, status: true } } },
  });
  // A suspended viewer keeps their login but is routed to the suspension/appeal screen.
  if (me?.suspendedAt) redirect("/suspended");
  // Permitted to tutor = a live linked tutor that hasn't been archived (can-tutor turned off).
  // Keyed off the DB link (`me.tutor`), not the JWT's `session.tutorId`, so toggling can-tutor on
  // shows the button on the next render without waiting for a re-login. The jwt callback keeps
  // `session.tutorId` in sync too, so following the link into the tutor area resolves correctly.
  const canEnterTutor = !!me?.tutor && me.tutor.status !== "ARCHIVED";

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
            <Link
              href="/admin/account"
              className="hidden rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 sm:block"
              title={t("account.title")}
            >
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
              <p className="muted text-xs">
                {me?.username ?? me?.tutor?.username
                  ? `@${me.username ?? me?.tutor?.username} · `
                  : ""}
                {session.role}
              </p>
            </Link>
            <ThemeSwitcher />
            <NotificationBell />
            <LanguageSwitcher />
            {canEnterTutor && (
              <Link href="/dashboard" className="btn-secondary btn-sm">
                {t("components.userMenu.enterTutor")}
              </Link>
            )}
            {me?.crewStatus === "ACTIVE" && (
              <Link href="/patrol" className="btn-secondary btn-sm">
                {t("crew.nav.patrol")}
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
        <NavMobileRow role={session.role} />
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-6">
        <NavSidebar role={session.role} />

        {/* Main content. `data-readonly` exposes the read-only VIEWER role to globals.css, which keeps
            only a thin destructive-control backstop; mutation panels are hidden per-page via
            useReadOnly(), and the server-side adminProcedure checks are the real guard. */}
        <main className="min-w-0 flex-1" data-readonly={readOnly ? "" : undefined}>
          {readOnly && (
            // Viewer's viewing pass — a welcoming accent strip, not an amber lockout warning
            // (the program values transparency). The eye glyph carries the "viewer" identity, so
            // the copy stays the single existing banner string.
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-2.5">
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-700 ring-1 ring-accent-200"
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
              <p className="text-sm leading-snug text-accent-800">{t("admin.readOnly.banner")}</p>
            </div>
          )}
          <ReadOnlyProvider value={readOnly}>{children}</ReadOnlyProvider>
        </main>
      </div>
    </div>
  );
}
