import { accountPortalAccess } from "~/server/portal-access";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { AdminPreferenceIdentity } from "~/app/_components/dismissible-notice";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { UserAvatar } from "~/app/_components/user-avatar";
import { NavSidebar, NavMobileRow } from "~/app/_components/admin-nav";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { InlineNotice } from "~/app/_components/ui/patterns";

/**
 * Gates management reads using current account capabilities. Departure observers receive
 * the same read-only UI and API masking as standalone Viewers.
 * Server-enforced; the middleware only checks authentication, not role.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const t = await getTranslations();

  if (!session?.user) redirect("/signin");
  const access = await accountPortalAccess(session.user.id);
  if (!access.canReadManagement) redirect("/");
  const readOnly = access.managementReadOnly;

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      name: true,
      email: true,
      username: true,
      crewStatus: true,
      canTranslate: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      mergedIntoId: true,
      schoolDeparture: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  // A suspended viewer keeps their login but is routed to the suspension/appeal screen.
  if (me?.suspendedAt) redirect("/suspended");
  const features = await getFeatures(db);
  const nav = resolveWorkspaceNavigation({
    account: {
      role: me?.role ?? session.role,
      suspendedAt: me?.suspendedAt ?? null,
      mergedIntoId: me?.mergedIntoId ?? null,
      crewStatus: me?.crewStatus ?? null,
      tutorAccessRevoked: me?.tutorAccessRevoked ?? false,
      canTranslate: me?.canTranslate ?? false,
      schoolDeparture: me?.schoolDeparture ?? null,
      tutor: me?.tutor ?? null,
    },
    crewEnabled: features.CREW,
    currentArea: "management",
    labels: workspaceNavLabels(t),
  });
  const accountItems = [
    {
      href: readOnly ? "/messages" : "/admin/messages",
      label: t("workflows.messages"),
      group: "tools" as const,
    },
    {
      href: readOnly ? "/student-support" : "/admin/student-support",
      label: t("workflows.support"),
      group: "tools" as const,
    },
    {
      href: "/admin/account",
      label: t("account.title"),
      group: "account" as const,
    },
  ];

  return (
    <div className="admin-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      {/* Unified top bar (all breakpoints): workspace selector left, global controls right. */}
      <WorkspaceHeader
        href="/admin"
        title={nav.managementLabel}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(t)}
        skipLabel={t("common.skipToContent")}
        skipToId="admin-content"
        identity={
          <Link
            href="/admin/account"
            className="hidden shrink-0 rounded-md px-2 py-0.5 text-right leading-tight hover:bg-slate-100 lg:block"
            title={t("account.title")}
          >
            <p className="text-[13px] font-medium text-slate-900">
              {me?.name ?? session.user.name}
            </p>
            <p className="muted text-[11px]">
              {(me?.username ?? me?.tutor?.username)
                ? `@${me.username ?? me?.tutor?.username} · `
                : ""}
              {t(`admin.users.roles.${session.role}`)}
            </p>
          </Link>
        }
        account={
          <UserAvatar
            name={
              me?.name ??
              session.user.name ??
              me?.email ??
              session.user.email ??
              session.role
            }
            username={me?.username ?? me?.tutor?.username}
            email={me?.email ?? session.user.email}
            role={session.role}
            items={accountItems}
            compactAtDesktop
          />
        }
        navigation={<NavMobileRow role={session.role} embedded />}
      />

      {/* The flex remainder follows the actual header height, including wrapping and zoom.
          Each desktop pane owns its scroll; no fixed pixel header offset can hide links. */}
      <div className="admin-workspace mx-auto flex w-full max-w-7xl gap-6 px-4 py-5 sm:py-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:px-6">
        <NavSidebar role={session.role} />

        {/* Main content. `data-readonly` exposes the read-only VIEWER role to globals.css, which keeps
            only a thin destructive-control backstop; mutation panels are hidden per-page via
            useReadOnly(), and the server-side adminProcedure checks are the real guard. */}
        <main
          id="admin-content"
          tabIndex={0}
          className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 lg:overflow-y-auto lg:overscroll-contain lg:pr-3"
          data-readonly={readOnly ? "" : undefined}
        >
          {readOnly && (
            // Viewer's viewing pass — a welcoming accent strip, not an amber lockout warning
            // (the program values transparency). The eye glyph carries the "viewer" identity, so
            // the copy stays the single existing banner string.
            <div className="border-accent-200 bg-accent-50 mb-5 flex items-center gap-3 rounded-xl border px-4 py-2.5">
              <span
                aria-hidden
                className="bg-accent-100 text-accent-700 ring-accent-200 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              </span>
              <p className="text-accent-800 text-sm leading-snug">
                {t("admin.readOnly.banner")}
              </p>
            </div>
          )}
          {session.role === "COORDINATOR" && (
            <div className="mb-5">
              <InlineNotice
                tone="warning"
                action={
                  <Link
                    className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
                    href="/admin/approvals?status=all"
                  >
                    {t("approvals.myRequests")}
                  </Link>
                }
              >
                <p>{t("approvals.trainingBanner")}</p>
              </InlineNotice>
            </div>
          )}
          <ReadOnlyProvider value={readOnly}>
            <AdminPreferenceIdentity value={session.user.id}>
              {children}
            </AdminPreferenceIdentity>
          </ReadOnlyProvider>
        </main>
      </div>
    </div>
  );
}
