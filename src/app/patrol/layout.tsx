import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { WorkspaceHeader } from "~/app/_components/workspace-header";
import { TEAM_TITLE } from "~/lib/branding";

/**
 * Gates the crew patrol portal. Requires a signed-in user flagged `isCrew` (a tutor can also be
 * crew) or an elevated role (admins/coordinators oversee the crew). Server-enforced, in addition to
 * the `crewProcedure` on every mutation.
 */
export default async function PatrolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Keep appeal access available even when crew access or the entire module is disabled.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { crewStatus: true, suspendedAt: true },
  });
  if (me?.suspendedAt) redirect("/suspended");

  // Crew module switched off program-wide -> no portal.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const elevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";
  // Crew (any status) and crew-only logins reach the portal; the page itself gates patrolling on
  // ACTIVE and shows a read-only notice otherwise. Elevated roles oversee the crew.
  const isCrew = me?.crewStatus != null || session.role === "CREW";
  if (!isCrew && !elevated) redirect("/");

  const t = await getTranslations();
  // Where "back" goes depends on what else this account is (crew-only logins have nowhere else).
  const backHref = elevated ? "/admin" : session.tutorId ? "/dashboard" : null;

  return (
    <div className="min-h-screen">
      <WorkspaceHeader
        href="/patrol"
        title={t("crew.brand", { team: TEAM_TITLE })}
        items={[
          ...(session.role !== "VIEWER"
            ? [{ href: "/student", label: t("components.userMenu.enterTutee") }]
            : []),
          ...(backHref ? [{ href: backHref, label: t("crew.exit") }] : []),
        ]}
        identity={
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{session.user.name}</p>
            <p className="muted text-xs">{t("crew.role")}</p>
          </div>
        }
        account={
          <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
        }
      />

      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
