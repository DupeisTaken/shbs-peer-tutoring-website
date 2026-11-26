import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { getFeatures } from "~/server/program/features";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import { UserAvatar } from "~/app/_components/user-avatar";
import { WorkspaceHeader } from "~/app/_components/workspace-header";

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
      tutorAccessRevoked: true,
      canTranslate: true,
      suspendedAt: true,
      mergedIntoId: true,
      schoolDeparture: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  if (me?.suspendedAt) redirect("/suspended");

  // Crew module switched off program-wide -> no portal.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const role = me?.role ?? session.role;
  const elevated =
    role === "HEAD" || role === "ADMIN" || role === "COORDINATOR";
  // Crew (any status) and crew-only logins reach the portal; the page itself gates patrolling on
  // ACTIVE and shows a read-only notice otherwise. Elevated roles oversee the crew.
  const isCrew = me?.crewStatus != null || role === "CREW";
  if (!isCrew && !elevated) redirect("/");

  const t = await getTranslations();
  const nav = resolveWorkspaceNavigation({
    account: {
      role,
      suspendedAt: me?.suspendedAt ?? null,
      mergedIntoId: me?.mergedIntoId ?? null,
      crewStatus: me?.crewStatus ?? null,
      tutorAccessRevoked: me?.tutorAccessRevoked ?? false,
      canTranslate: me?.canTranslate ?? false,
      schoolDeparture: me?.schoolDeparture ?? null,
      tutor: me?.tutor ?? null,
    },
    crewEnabled: features.CREW,
    currentArea: "crew",
    labels: workspaceNavLabels(t),
  });
  const canTutor =
    !me?.tutorAccessRevoked &&
    !!me?.tutor &&
    (!elevated || me.tutor.status !== "ARCHIVED");
  const accountHref = elevated
    ? "/admin/account"
    : canTutor
      ? "/settings"
      : "/my-account";
  const accountLabel = t(
    elevated ? "account.title" : "components.userMenu.settings",
  );
  const accountItems = [
    {
      href: elevated ? "/admin/messages" : "/messages",
      label: t("workflows.messages"),
      group: "tools" as const,
    },
    {
      href: accountHref,
      label: accountLabel,
      group: "account" as const,
    },
  ];
  const displayName = me?.name ?? session.user.name ?? me?.email ?? role;
  const username = me?.username ?? me?.tutor?.username;

  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/patrol"
        title={t("components.workspaceTitles.patrol")}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(t)}
        skipLabel={t("common.skipToContent")}
        account={
          <UserAvatar
            name={displayName}
            username={username}
            email={me?.email ?? session.user.email}
            role={role}
            roleLabel={t("crew.role")}
            items={accountItems}
            compactAtDesktop
          />
        }
      />

      <main
        id="main-content"
        className="mx-auto max-w-5xl px-4 py-5 sm:py-6 lg:px-6"
      >
        {children}
      </main>
    </div>
  );
}
