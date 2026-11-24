import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { UserAvatar } from "~/app/_components/user-avatar";
import { NavSidebar, NavMobileRow } from "~/app/_components/admin-nav";
import { translationAccess } from "~/lib/translation-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";

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
      crewStatus: true,
      tutorId: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      mergedIntoId: true,
      schoolDeparture: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  if (!me) redirect("/signin");
  if (me.suspendedAt) redirect("/suspended");
  const access = translationAccess(me);
  if (!access.enter) redirect("/");
  const elevated = access.publish || access.request;

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  const nav = resolveWorkspaceNavigation({
    account: me,
    crewEnabled: features.CREW,
    currentArea: "translations",
    labels: workspaceNavLabels(t),
  });
  const accountHref = elevated ? "/admin/account" : "/my-account";
  const accountItems = [
    {
      href: elevated ? "/admin/messages" : "/messages",
      label: t("workflows.messages"),
      group: "tools" as const,
    },
    ...(elevated
      ? [
          {
            href: "/admin/student-support",
            label: t("workflows.support"),
            group: "tools" as const,
          },
        ]
      : []),
    {
      href: accountHref,
      label: t(elevated ? "account.title" : "components.userMenu.settings"),
      group: "account" as const,
    },
  ];
  const displayName = me.name ?? session.user.name ?? me.email ?? me.role;
  const username = me.username ?? me.tutor?.username;

  return (
    <div
      className={
        elevated
          ? "admin-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
          : "min-h-screen"
      }
    >
      <WorkspaceHeader
        href="/localization"
        title={t("components.workspaceTitles.translations")}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(t)}
        skipLabel={t("common.skipToContent")}
        skipToId={elevated ? "admin-content" : "main-content"}
        navigation={
          elevated ? <NavMobileRow role={me.role} embedded /> : undefined
        }
        identity={
          <Link
            href={accountHref}
            className="hidden shrink-0 rounded-md px-2 py-0.5 text-right leading-tight hover:bg-slate-100 lg:block"
            title={t("account.title")}
          >
            <p className="text-[13px] font-medium text-slate-900">{displayName}</p>
            <p className="muted text-[11px]">
              {username ? `@${username} · ` : ""}
              {t(`admin.users.roles.${me.role}`)}
            </p>
          </Link>
        }
        account={
          <UserAvatar
            name={displayName}
            username={username}
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
