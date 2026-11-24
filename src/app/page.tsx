import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { APP_TITLE } from "~/lib/branding";
import { portalAccess } from "~/lib/portal-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import { LandingView } from "~/app/_components/landing-view";
import { UserAvatar } from "~/app/_components/user-avatar";
import { WorkspaceHeader } from "~/app/_components/workspace-header";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ home?: string }>;
} = {}) {
  const params = searchParams ? await searchParams : undefined;
  const session = await auth();
  if (session?.user) {
    const account = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
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
      },
    });
    if (account?.suspendedAt) redirect("/suspended");

    // Signed-in users reaching Program Home via the workspace switcher (`/?home=1`)
    // view the landing page with the logo-only workspace switcher and no guest actions.
    if (params?.home === "1" && account && !account.mergedIntoId) {
      const [t, features] = await Promise.all([
        getTranslations(),
        getFeatures(db),
      ]);
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
        crewEnabled: features.CREW,
        currentArea: "home",
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
        <LandingView
          signedInHeader={
            <WorkspaceHeader
              href="/?home=1"
              title={APP_TITLE}
              switcherItems={nav.items}
              switcherLabels={workspaceSwitcherLabels(t)}
              skipLabel={t("common.skipToContent")}
              containerClassName="mx-auto max-w-5xl"
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
          }
        />
      );
    }

    // Default root visit: signed-in users skip the landing page and go straight to their area.
    // Neutral alumni logins land on personal evidence without a current-consent detour.
    if (session.role === "STUDENT")
      redirect(
        account && !account.studentId && !account.tuteeMember
          ? "/history"
          : "/student",
      );
    const adminArea =
      session.role === "HEAD" ||
      session.role === "ADMIN" ||
      session.role === "COORDINATOR" ||
      session.role === "VIEWER";
    // A transferred tutor can retain the TUTOR role while its execution link is
    // revoked. Preserve independent tutee participation, otherwise use history
    // instead of sending the login into a tutor-layout redirect loop.
    redirect(
      adminArea
        ? "/admin"
        : session.role === "CREW"
          ? "/patrol"
          : session.tutorId
            ? "/dashboard"
            : account?.studentId || account?.tuteeMember
              ? "/student"
              : "/history",
    );
  }

  return <LandingView />;
}
