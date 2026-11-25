import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

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
import { UserAvatar } from "~/app/_components/user-avatar";
import { WorkspaceHeader } from "~/app/_components/workspace-header";

export const SIGNED_IN_HEADER_ACCOUNT_SELECT = {
  name: true,
  email: true,
  username: true,
  role: true,
  suspendedAt: true,
  mergedIntoId: true,
  studentId: true,
  tuteeMember: true,
  crewStatus: true,
  tutorAccessRevoked: true,
  canTranslate: true,
  schoolDeparture: true,
  tutor: { select: { username: true, status: true } },
} as const;

export type SignedInHeaderAccount = {
  name: string | null;
  email: string;
  username: string | null;
  role: string;
  suspendedAt: Date | null;
  mergedIntoId: string | null;
  studentId: string | null;
  tuteeMember: boolean;
  crewStatus: string | null;
  tutorAccessRevoked: boolean;
  canTranslate: boolean;
  schoolDeparture: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
  tutor: { username: string | null; status: string } | null;
};

type RootTranslator = ((key: string) => string) & {
  has: (key: string) => boolean;
};

/**
 * Build the shared signed-in `WorkspaceHeader` for cross-area surfaces such as
 * Program Home (`/`) and public signup forms (`(PT) Signup Forms`).
 */
export function renderSignedInWorkspaceHeader({
  account,
  crewEnabled,
  t,
  href,
  title,
  currentArea,
  containerClassName = "mx-auto max-w-5xl",
}: {
  account: SignedInHeaderAccount;
  crewEnabled: boolean;
  t: RootTranslator;
  href: string;
  title: string;
  currentArea: WorkspaceArea | null;
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
  const accountHref = staff
    ? "/admin/account"
    : canTutor
      ? "/settings"
      : canTutee
        ? "/student?view=account"
        : "/my-account";
  const displayName = account.name ?? account.username ?? account.email;
  const username = account.username ?? account.tutor?.username;
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
      label: t(staff ? "account.title" : "components.userMenu.settings"),
      group: "account" as const,
    },
  ];

  return (
    <WorkspaceHeader
      href={href}
      title={title}
      switcherItems={nav.items}
      switcherLabels={workspaceSwitcherLabels(t)}
      skipLabel={t("common.skipToContent")}
      containerClassName={containerClassName}
      identity={
        <Link
          href={accountHref}
          className="hidden shrink-0 rounded-md px-2 py-0.5 text-right leading-tight hover:bg-slate-100 lg:block"
          title={t("account.title")}
        >
          <p className="text-[13px] font-medium text-slate-900">
            {displayName}
          </p>
          <p className="muted text-[11px]">
            {username ? `@${username} · ` : ""}
            {t.has(`admin.users.roles.${account.role}`)
              ? t(`admin.users.roles.${account.role}`)
              : account.role}
          </p>
        </Link>
      }
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
 * Resolve a signed-in `WorkspaceHeader` for a public/shared route (e.g. signup forms).
 * Signed-out, suspended, or merged accounts receive `null` without leaking private reads.
 */
export async function getSignedInWorkspaceHeader({
  href = "/",
  title,
  currentArea = null,
  containerClassName = "mx-auto max-w-5xl",
}: {
  href?: string;
  title: string;
  currentArea?: WorkspaceArea | null;
  containerClassName?: string;
}): Promise<ReactNode> {
  const session = await auth();
  if (!session?.user) return null;
  const [account, features, t] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: SIGNED_IN_HEADER_ACCOUNT_SELECT,
    }),
    getFeatures(db),
    getTranslations(),
  ]);
  if (!account || account.suspendedAt || account.mergedIntoId) return null;
  return renderSignedInWorkspaceHeader({
    account,
    crewEnabled: features.CREW,
    t,
    href,
    title,
    currentArea,
    containerClassName,
  });
}

/**
 * Resolve role-aware public link replacements for the current session on published
 * public pages (such as `/p/[slug]`). Returns `undefined` for signed-out, suspended,
 * or merged visitors without querying private account records when signed out.
 */
export async function getSignedInLandingLinks(): Promise<
  SignedInLinkMap | undefined
> {
  const session = await auth();
  if (!session?.user) return undefined;
  const [account, features, t] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: SIGNED_IN_HEADER_ACCOUNT_SELECT,
    }),
    getFeatures(db),
    getTranslations(),
  ]);
  if (!account || account.suspendedAt || account.mergedIntoId) return undefined;
  return resolveSignedInLandingLinks({
    account,
    crewEnabled: features.CREW,
    labels: signedInLandingLinkLabels(t),
  });
}
