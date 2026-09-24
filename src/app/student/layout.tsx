import { TRPCError } from "@trpc/server";
import { currentPolicy } from "~/server/policy-acceptance";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";
import { UserAvatar } from "~/app/_components/user-avatar";
import { TuteeNavigation } from "./navigation";
import { getFeatures } from "~/server/program/features";
import { tuteePeriodMessages } from "./period-messages";

/** Participation is independent of role. All active accounts enter; APIs scope records by ownership. */
export default async function TuteeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const [me, t, messages, features] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        username: true,
        role: true,
        tuteeMember: true,
        crewStatus: true,
      tutorAccessRevoked: true,
        canTranslate: true,
        suspendedAt: true,
        tutor: { select: { status: true } },
      },
    }),
    getTranslations(),
    getMessages(),
    getFeatures(db),
  ]);
  if (!me) redirect("/signin");
  if (me.suspendedAt) redirect("/suspended");
  if (me.role === "VIEWER") redirect("/admin/account");
  // Visiting offers onboarding, never silently grants participation. The root policy gate
  // records an exact revision and refreshes this server boundary after acceptance.
  const policy = await currentPolicy(db, "tutee-policy").catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED") return null;
    throw error;
  });
  const acceptance = policy ? await db.policyAcceptance.findUnique({ where: {
    userId_slug_revision: { userId: session.user.id, slug: "tutee-policy", revision: policy.revision },
  } }) : null;
  const pastAcceptance = acceptance ?? (me.tutor ? await db.policyAcceptance.findFirst({ where: { userId: session.user.id, slug: "tutee-policy" } }) : null);
  const hasAccess = me.tuteeMember && (!me.tutor || !!pastAcceptance);
  const elevated = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(me.role);
  const canTutor = !me.tutorAccessRevoked && !!me.tutor && (!elevated || me.tutor.status !== "ARCHIVED");
  const workspaceItems = [
    ...(canTutor
      ? [{ href: "/dashboard", label: t("components.userMenu.enterTutor") }]
      : []),
    ...(elevated
      ? [{ href: "/admin", label: t("components.userMenu.backToManagement") }]
      : []),
  ];
  const items = [
    ...workspaceItems,
    { href: "/student?view=account", label: t("tuteePortal.account") },
    { href: "/student?view=messages", label: t("tuteePortal.messages") },
    ...(me.crewStatus === "ACTIVE" && features.CREW
      ? [{ href: "/patrol", label: t("crew.nav.patrol") }]
      : []),
    ...(me.canTranslate
      ? [{ href: "/localization", label: t("localization.navLabel") }]
      : []),
  ];
  const content = (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/student"
        title={APP_TITLE}
        items={workspaceItems}
        identity={
          <Link
            href="/student?view=account"
            className="hidden max-w-48 truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-100 lg:block"
          >
            {me.name ?? me.username}
          </Link>
        }
        account={
          <UserAvatar
            name={me.name ?? me.username ?? me.email}
            username={me.username}
            email={me.email}
            role={me.role}
            items={items}
            compactAtDesktop
          />
        }
      />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:py-8">
        {hasAccess ? <><TuteeNavigation />{children}</> : (
          <section className="card space-y-3 p-5">
            <h1 className="page-title">{t("workflow.policyTitle")}</h1>
            <p className="muted">{t(policy ? "workflow.policyConsequences" : "workflow.policyLoadError")}</p>
          </section>
        )}
      </main>
    </div>
  );
  // Nested messages affect client workflow panels without changing global policy-gate copy.
  return features.QUARTER_SYSTEM ? (
    content
  ) : (
    <NextIntlClientProvider messages={tuteePeriodMessages(messages, false)}>
      {content}
    </NextIntlClientProvider>
  );
}
