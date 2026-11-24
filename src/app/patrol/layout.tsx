import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { getFeatures } from "~/server/program/features";
import { UserAvatar } from "~/app/_components/user-avatar";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { TEAM_TITLE } from "~/lib/branding";

export async function generateMetadata() {
  return pageMetadata("crew.patrol.title");
}

/**
 * Gates the crew patrol portal. Requires a signed-in user flagged `isCrew` (a tutor can also be
 * crew) or an elevated role (admins/coordinators oversee the crew). Server-enforced, in addition to
 * the `crewProcedure` on every mutation.
 */
export default async function PatrolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Keep appeal access available even when crew access or the entire module is disabled.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      username: true,
      role: true,
      crewStatus: true,
      canTranslate: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  if (me?.suspendedAt) redirect("/suspended");

  // Crew module switched off program-wide -> no portal.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const elevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";
  // Crew (any status) and crew-only logins reach the portal; the page itself gates patrolling on
  // ACTIVE and shows a read-only notice otherwise. Elevated roles oversee the crew.
  const isCrew = me?.crewStatus != null || session.role === "CREW";
  if (!isCrew && !elevated) redirect("/");

  const t = await getTranslations();
  const canTutor =
    !me?.tutorAccessRevoked &&
    !!me?.tutor &&
    (!elevated || me.tutor.status !== "ARCHIVED");
  // Where "back" goes depends on what else this account is (crew-only logins have nowhere else).
  const backHref = elevated ? "/admin" : canTutor ? "/dashboard" : null;
  const accountHref = elevated
    ? "/admin/account"
    : canTutor
      ? "/settings"
      : "/my-account";
  const accountLabel = elevated
    ? t("account.title")
    : t("workflows.settings");
  const handle = me?.username ?? me?.tutor?.username;
  const displayName =
    me?.name ?? session.user.name ?? me?.email ?? session.user.email ?? t("crew.role");

  const workspaceItems = [
    ...(session.role !== "VIEWER"
      ? [{ href: "/student", label: t("components.userMenu.enterTutee") }]
      : []),
    ...(backHref ? [{ href: backHref, label: t("crew.exit") }] : []),
  ];
  const accountItems = [
    { href: accountHref, label: accountLabel },
    {
      href: elevated ? "/admin/messages" : "/messages",
      label: t("workflows.messages"),
    },
    ...(me?.canTranslate
      ? [{ href: "/localization", label: t("localization.navLabel") }]
      : []),
  ];

  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/patrol"
        title={t("crew.brand", { team: TEAM_TITLE })}
        skipLabel={t("common.skipToContent")}
        containerClassName="mx-auto max-w-5xl"
        items={workspaceItems}
        identity={
          <Link
            href={accountHref}
            className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
            title={accountLabel}
          >
            <p className="max-w-44 truncate text-sm font-medium text-slate-900">
              {me?.name ?? session.user.name}
            </p>
            <p className="muted text-xs">
              {handle ? `@${handle} · ` : ""}
              {t("crew.role")}
            </p>
          </Link>
        }
        account={
          <UserAvatar
            name={displayName}
            username={handle}
            email={me?.email ?? session.user.email}
            role={me?.role ?? session.role}
            items={accountItems}
            compactAtDesktop
          />
        }
      />

      <main id="main-content" className="mx-auto max-w-5xl px-4 py-5 sm:py-6">
        {children}
      </main>
    </div>
  );
}
