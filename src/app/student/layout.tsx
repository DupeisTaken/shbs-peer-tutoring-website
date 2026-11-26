import { Suspense } from "react";
import { portalAccess } from "~/lib/portal-access";
import {
  resolveWorkspaceNavigation,
  workspaceNavLabels,
  workspaceSwitcherLabels,
} from "~/lib/workspace-navigation";
import { DepartureBanner } from "~/app/_components/school-departure";
import { TRPCError } from "@trpc/server";
import { currentPolicy, findAccountPolicy } from "~/server/policy-acceptance";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { redirect } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { UserAvatar } from "~/app/_components/user-avatar";
import { getFeatures } from "~/server/program/features";
import { tuteePeriodMessages } from "./period-messages";
import { TuteePersonalView } from "./personal-view";

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
        mergedIntoId: true,
        schoolDeparture: true,
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
  const policy = await currentPolicy(db, "tutee-policy").catch(
    (error: unknown) => {
      if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED")
        return null;
      throw error;
    },
  );
  const acceptance = policy
    ? await findAccountPolicy(
        db,
        session.user.id,
        "tutee-policy",
        policy.revision,
      )
    : null;
  const pastAcceptance =
    acceptance ??
    (me.tutor
      ? await findAccountPolicy(db, session.user.id, "tutee-policy")
      : null);
  const access = portalAccess(me);
  const hasAccess =
    access.departed || (me.tuteeMember && (!me.tutor || !!pastAcceptance));
  const nav = resolveWorkspaceNavigation({
    account: me,
    crewEnabled: features.CREW,
    currentArea: "tutee",
    labels: workspaceNavLabels(t),
  });
  const items = [
    {
      href: "/student?view=messages",
      label: t("tuteePortal.messages"),
      group: "tools" as const,
    },
    {
      href: "/student?view=account",
      label: t("tuteePortal.account"),
      group: "account" as const,
    },
  ];
  const participationNotice = (
    <section className="card space-y-3 p-5">
      <h1 className="page-title">{t("workflow.policyTitle")}</h1>
      <p className="muted">
        {t(policy ? "workflow.policyConsequences" : "workflow.policyLoadError")}
      </p>
    </section>
  );
  const content = (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/student"
        title={t("components.workspaceTitles.tutee")}
        switcherItems={nav.items}
        switcherLabels={workspaceSwitcherLabels(t)}
        skipLabel={t("common.skipToContent")}
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
      <main id="main-content" className="min-w-0">
        {hasAccess ? (
          children
        ) : (
          <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-6 lg:px-6">
            <DepartureBanner />
            <Suspense fallback={participationNotice}>
              <TuteePersonalView fallback={participationNotice} />
            </Suspense>
          </div>
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
