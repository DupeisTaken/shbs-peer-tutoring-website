import { accountPortalAccess } from "~/server/portal-access";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { AdminPreferenceIdentity } from "~/app/_components/dismissible-notice";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { UserAvatar } from "~/app/_components/user-avatar";
import { NavSidebar, NavMobileRow } from "~/app/_components/admin-nav";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { AdminReadOnlyBanner } from "~/app/_components/admin-read-only-banner";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { TEAM_TITLE } from "~/lib/branding";

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

  // Username for the identity block in the top bar (account handle, falling back to a linked
  // tutor's). The block links to the self-service account page. The tutor `status` decides whether
  // to show the "Enter tutor" hop: an ARCHIVED tutor means can-tutor is off (not permitted) — we
  // keep the link to preserve attributes, so check the live status rather than the JWT's tutorId.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      username: true,
      crewStatus: true,
      tutorAccessRevoked: true,
      suspendedAt: true,
      tutor: { select: { username: true, status: true } },
    },
  });
  // A suspended viewer keeps their login but is routed to the suspension/appeal screen.
  if (me?.suspendedAt) redirect("/suspended");
  // Permitted to tutor = a live linked tutor that hasn't been archived (can-tutor turned off).
  // Keyed off the DB link (`me.tutor`), not the JWT's `session.tutorId`, so toggling can-tutor on
  // shows the button on the next render without waiting for a re-login. The jwt callback keeps
  // `session.tutorId` in sync too, so following the link into the tutor area resolves correctly.
  const canEnterTutor = !me?.tutorAccessRevoked && !!me?.tutor && me.tutor.status !== "ARCHIVED";
  const features = await getFeatures(db);
  // Workspace switches stay in the header bar; keep the avatar menu focused on account shortcuts.
  const workspaceItems = [
    ...(canEnterTutor
      ? [{ href: "/dashboard", label: t("components.userMenu.enterTutor") }]
      : []),
    ...(!readOnly || access.departed ? [{ href: "/student", label: t("components.userMenu.enterTutee") }] : []),
  ];
  const accountItems = [
    { href: "/admin/account", label: t("account.title") },
    ...(readOnly
      ? [
          { href: "/messages", label: t("workflows.messages") },
          { href: "/student-support", label: t("workflows.support") },
        ]
      : []),
    ...(features.CREW && me?.crewStatus === "ACTIVE"
      ? [{ href: "/patrol", label: t("crew.nav.patrol") }]
      : []),
  ];

  return (
    <div className="admin-shell min-h-dvh lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      {/* Unified top bar (all breakpoints): brand + the global controls. */}
      <WorkspaceHeader
        href="/admin"
        title={TEAM_TITLE}
        items={workspaceItems}
        skipLabel={t("common.skipToContent")}
        skipToId="admin-content"
        identity={
          <Link
            href="/admin/account"
            className="hidden shrink-0 rounded-md px-2 py-1 text-right leading-tight hover:bg-slate-100 lg:block"
            title={t("account.title")}
          >
            <p className="text-sm font-medium text-slate-900">
              {me?.name ?? session.user.name}
            </p>
            <p className="muted text-xs">
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
            // Viewer's viewing pass — hidden on self-service /admin/account where the user's
            // own account controls stay interactive.
            <AdminReadOnlyBanner message={t("admin.readOnly.banner")} />
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
