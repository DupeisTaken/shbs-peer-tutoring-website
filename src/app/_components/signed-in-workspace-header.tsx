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
import {
  resolveSignedInLandingLinks,
  signedInLandingLinkLabels,
  type SignedInLinkMap,
} from "~/lib/signed-in-landing-links";
import { UserAvatar } from "./user-avatar";
import { WorkspaceHeader } from "./workspace-header";

export const SIGNED_IN_HEADER_ACCOUNT_SELECT = {
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
} as const;

export type SignedInHeaderAccount = {
  name: string | null;
  email: string;
  username: string | null;
  role: string;
  crewStatus: string | null;
  tuteeMember: boolean;
  studentId: string | null;
  tutorAccessRevoked: boolean;
  canTranslate: boolean;
  suspendedAt: Date | null;
  mergedIntoId: string | null;
  schoolDeparture: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
  tutor: { username: string | null; status: string } | null;
};

/**
 * Pure builder for the unified signed-in `WorkspaceHeader` across Program Home,
 * signup forms, and shared public routes.
 */
export function renderSignedInWorkspaceHeader({
  account,
  crewEnabled,
  t,
  href,
  title,
  currentArea = null,
  containerClassName = "mx-auto w-full max-w-7xl",
}: {
  account: SignedInHeaderAccount;
  crewEnabled: boolean;
  t: (key: string) => string;
  href: string;
  title: string;
  currentArea?: WorkspaceArea | null;
  containerClassName?: string;
}): ReactNode {
  const access = portalAccess(account);
  const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(account.role);
  const elevated = staff || account.role === "VIEWER";
  const canTutor =
    !account.tutorAccessRevoked &&
    !!account.tutor &&
    (!elevated || account.tutor.status !== "ARCHIVED");
  const canTutee =
    account.role !== "VIEWER" && (access.canParticipate || access.departed);

  const nav = resolveWorkspaceNavigation({
    account,
    crewEnabled,
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
      : account.role === "VIEWER"
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

  const displayName = account.name ?? account.username ?? account.email;
  const username = account.username ?? account.tutor?.username;

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
          email={account.email}
          role={account.role}
          items={accountItems}
          compactAtDesktop
        />
      }
    />
  );
}

/**
 * Resolves the unified signed-in WorkspaceHeader for shared/public routes (invitation
 * entry, personal history, program pages, privacy, signup forms). Returns null for
 * signed-out, suspended, or merged accounts so callers fall back cleanly to PublicHeader.
 */
export async function getSignedInWorkspaceHeader({
  href,
  title,
  currentArea = null,
  containerClassName = "mx-auto w-full max-w-7xl",
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
    select: SIGNED_IN_HEADER_ACCOUNT_SELECT,
  });
  if (!me || me.suspendedAt || me.mergedIntoId) return null;

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  return renderSignedInWorkspaceHeader({
    account: me,
    crewEnabled: features.CREW,
    t,
    href,
    title,
    currentArea,
    containerClassName,
  });
}

/**
 * Resolves role-aware public link replacements for the current session on published
 * public pages (such as `/p/[slug]`). Returns `undefined` for signed-out, suspended,
 * or merged visitors without querying private account records when signed out.
 */
export async function getSignedInLandingLinks({
  session,
}: {
  session?: Session | null;
} = {}): Promise<SignedInLinkMap | undefined> {
  let activeSession = session;
  if (activeSession === undefined) {
    try {
      activeSession = await auth();
    } catch {
      return undefined;
    }
  }
  if (!activeSession?.user?.id) return undefined;
  if (typeof db?.user?.findUnique !== "function") return undefined;

  const me = await db.user.findUnique({
    where: { id: activeSession.user.id },
    select: SIGNED_IN_HEADER_ACCOUNT_SELECT,
  });
  if (!me || me.suspendedAt || me.mergedIntoId) return undefined;

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  return resolveSignedInLandingLinks({
    account: me,
    crewEnabled: features.CREW,
    labels: signedInLandingLinkLabels(t),
  });
}
