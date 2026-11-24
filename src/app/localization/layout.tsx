import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { UserAvatar } from "~/app/_components/user-avatar";
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
      name: true,
      email: true,
      username: true,
      canTranslate: true,
      role: true,
      tutorId: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      tutor: { select: { username: true, status: true } },
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
  const canTutor =
    !me.tutorAccessRevoked &&
    Boolean(me.tutorId ?? me.tutor) &&
    (!adminArea || me.tutor?.status !== "ARCHIVED");
  const home = adminArea ? "/admin" : canTutor ? "/dashboard" : "/";
  const accountHref = adminArea
    ? "/admin/account"
    : canTutor
      ? "/settings"
      : "/my-account";
  const accountLabel = adminArea
    ? t("account.title")
    : t("workflows.settings");
  const handle = me.username ?? me.tutor?.username;
  const displayName =
    me.name ?? session.user.name ?? me.email ?? session.user.email ?? me.role;

  const workspaceItems = elevated
    ? [
        ...(canTutor
          ? [{ href: "/dashboard", label: t("components.userMenu.enterTutor") }]
          : []),
        { href: "/student", label: t("components.userMenu.enterTutee") },
      ]
    : [{ href: home, label: t("localization.back") }];

  const accountItems = [
    { href: accountHref, label: accountLabel },
    ...(!elevated
      ? [{ href: "/messages", label: t("workflows.messages") }]
      : []),
  ];

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
        skipLabel={t("common.skipToContent")}
        skipToId={elevated ? "admin-content" : "main-content"}
        items={workspaceItems}
        navigation={
          elevated ? <NavMobileRow role={me.role} embedded /> : undefined
        }
        identity={
          <Link
            href={accountHref}
            className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
            title={accountLabel}
          >
            <p className="max-w-44 truncate text-sm font-medium text-slate-900">
              {me.name ?? session.user.name}
            </p>
            <p className="muted text-xs">
              {handle ? `@${handle} · ` : ""}
              {t(`admin.users.roles.${me.role}`)}
            </p>
          </Link>
        }
        account={
          <UserAvatar
            name={displayName}
            username={handle}
            email={me.email ?? session.user.email}
            role={me.role}
            items={accountItems}
            compactAtDesktop
          />
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
        <main id="main-content" className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
          {children}
        </main>
      )}
    </div>
  );
}
