import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
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
      <WorkspaceHeader
        href={home}
        title={TEAM_TITLE}
        items={elevated ? [] : [{ href: home, label: t("localization.back") }]}
        navigation={
          elevated ? <NavMobileRow role={me.role} embedded /> : undefined
        }
        identity={
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{session.user.name}</p>
            <p className="muted text-xs">
              {me.tutor?.username ? `@${me.tutor.username} · ` : ""}
              {t(`admin.users.roles.${me.role}`)}
            </p>
          </div>
        }
        account={
          <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
        }
      />

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
