import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { Session } from "next-auth";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { portalAccess } from "~/lib/portal-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
  type WorkspaceArea,
} from "~/lib/workspace-navigation";
import { UserAvatar } from "./user-avatar";
import { WorkspaceHeader } from "./workspace-header";

/**
 * Resolves the unified signed-in WorkspaceHeader for shared/public routes (invitation
 * entry, personal history, program pages, privacy, signup forms). Returns null for
 * signed-out, suspended, or merged accounts so callers fall back cleanly to PublicHeader.
 */
export async function getSignedInWorkspaceHeader({
  href,
  title,
  currentArea = null,
  containerClassName = "mx-auto max-w-5xl",
  session,
}: {
  href: string;
  title: string;
  currentArea?: WorkspaceArea | null;
  containerClassName?: string;
  /** Optional already-resolved session so callers avoid a second auth() read. */
  session?: Session | null;
}): Promise<ReactNode | null> {
  let activeSession = session;
  if (activeSession === undefined) {
    try {
      activeSession = await auth();
    } catch {
      return null;
    }
  }
  if (!activeSession?.user?.id) return null;
  if (typeof db?.user?.findUnique !== "function") return null;

  const me = await db.user.findUnique({
    where: { id: activeSession.user.id },
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
  });
  if (!me || me.suspendedAt || me.mergedIntoId) return null;

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
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
    currentArea,
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
    <WorkspaceHeader
      href={href}
      title={title}
      switcherItems={nav.items}
      switcherLabels={workspaceSwitcherLabels(t)}
      skipLabel={t("common.skipToContent")}
      containerClassName={containerClassName}
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
  );
}
