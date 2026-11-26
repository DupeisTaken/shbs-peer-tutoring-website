import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { UserAvatar } from "~/app/_components/user-avatar";
import { portalAccess } from "~/lib/portal-access";
import { translationAccess } from "~/lib/translation-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import { TranslationIntentRecoveryEntry } from "~/app/_components/translation-intent-recovery";

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
      tuteeMember: true,
      studentId: true,
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
  // Losing editor access must not strand this account's metadata-only receipts.
  // The private page never mounts in this branch; GET/Stop retain their own live
  // session and original-actor authorization on the server.
  const content = access.enter ? (
    children
  ) : (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <TranslationIntentRecoveryEntry />
    </div>
  );
  const elevated = access.publish || access.request;
  const elevatedOrViewer = elevated || me.role === "VIEWER";
  const portal = portalAccess(me);

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  const nav = resolveWorkspaceNavigation({
    account: me,
    crewEnabled: features.CREW,
    currentArea: "translations",
    labels: workspaceNavLabels(t),
  });
  const canTutor =
    !me.tutorAccessRevoked &&
    Boolean(me.tutorId ?? me.tutor) &&
    (!elevatedOrViewer || me.tutor?.status !== "ARCHIVED");
  const canTutee =
    me.role !== "VIEWER" && (portal.canParticipate || portal.departed);
  const accountHref = elevatedOrViewer
    ? "/admin/account"
    : canTutor
      ? "/settings"
      : canTutee
        ? "/student?view=account"
        : "/my-account";
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
      label: t(
        elevatedOrViewer ? "account.title" : "components.userMenu.settings",
      ),
      group: "account" as const,
    },
  ];
  const displayName = me.name ?? session.user.name ?? me.email ?? me.role;
  const username = me.username ?? me.tutor?.username;

  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/localization"
        title={t("components.workspaceTitles.translations")}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(t)}
        skipLabel={t("common.skipToContent")}
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

      {/* Dedicated sidebar-free Translations workspace for every authorized editor and reviewer. */}
      <main id="main-content" className="min-w-0">
        {content}
      </main>
    </div>
  );
}
