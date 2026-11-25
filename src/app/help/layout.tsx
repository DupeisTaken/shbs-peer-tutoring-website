import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { portalAccess } from "~/lib/portal-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import { PublicHeader } from "~/app/_components/public-header";
import { UserAvatar } from "~/app/_components/user-avatar";
import { WorkspaceHeader } from "~/app/_components/workspace-header";

export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, t] = await Promise.all([auth(), getTranslations()]);

  const me = session?.user
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          name: true,
          email: true,
          username: true,
          role: true,
          crewStatus: true,
          tuteeMember: true,
          studentId: true,
          tutorAccessRevoked: true,
          canTranslate: true,
          suspendedAt: true,
          mergedIntoId: true,
          schoolDeparture: true,
          tutor: { select: { username: true, status: true } },
        },
      })
    : null;

  if (me && !me.suspendedAt && !me.mergedIntoId) {
    const features = await getFeatures(db);
    const access = portalAccess(me);
    const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(me.role);
    const elevated = staff || me.role === "VIEWER";
    const canTutor =
      !me.tutorAccessRevoked &&
      !!me.tutor &&
      (!elevated || me.tutor.status !== "ARCHIVED");
    const canTutee =
      me.role !== "VIEWER" && (access.canParticipate || access.departed);

    const nav = resolveWorkspaceNavigation({
      account: me,
      crewEnabled: features.CREW,
      currentArea: "help",
      labels: workspaceNavLabels(t),
    });

    const accountHref = elevated
      ? "/admin/account"
      : canTutor
        ? "/settings"
        : canTutee
          ? "/student?view=account"
          : "/my-account";

    const accountItems = [
      {
        href: staff ? "/admin/messages" : "/messages",
        label: t("workflows.messages"),
        group: "tools" as const,
      },
      ...(staff
        ? [
            {
              href: "/admin/student-support",
              label: t("workflows.support"),
              group: "tools" as const,
            },
          ]
        : me.role === "VIEWER"
          ? [
              {
                href: "/student-support",
                label: t("workflows.support"),
                group: "tools" as const,
              },
            ]
          : []),
      ...(canTutor
        ? [
            {
              href: "/handbook",
              label: t("tutor.nav.handbook"),
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

    const displayName = me.name ?? me.username ?? me.email;
    const username = me.username ?? me.tutor?.username;

    return (
      <div className="min-h-screen">
        <WorkspaceHeader
          href="/help"
          title={t("helpNav.title")}
          switcherItems={nav.items}
          switcherLabels={workspaceSwitcherLabels(t)}
          skipLabel={t("common.skipToContent")}
          containerClassName="mx-auto max-w-6xl"
          account={
            <UserAvatar
              name={displayName}
              username={username}
              email={me.email}
              role={me.role}
              items={accountItems}
              compactAtDesktop
            />
          }
        />
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PublicHeader
        href="/"
        title={t("helpNav.title")}
        linkTitle={t("common.backToMain")}
        skipLabel={t("common.skipToContent")}
      />
      {children}
    </div>
  );
}
