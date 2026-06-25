import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { ThemeSwitcher } from "~/app/_components/theme-switcher";
import { TEAM_TITLE } from "~/lib/branding";

/**
 * Gates the crew patrol portal. Requires a signed-in user flagged `isCrew` (a tutor can also be
 * crew) or an elevated role (admins/coordinators oversee the crew). Server-enforced, in addition to
 * the `crewProcedure` on every mutation.
 */
export default async function PatrolLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  // Crew module switched off program-wide -> no portal.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const elevated =
    session.role === "HEAD" || session.role === "ADMIN" || session.role === "COORDINATOR";
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { crewStatus: true },
  });
  // Crew (any status) and crew-only logins reach the portal; the page itself gates patrolling on
  // ACTIVE and shows a read-only notice otherwise. Elevated roles oversee the crew.
  const isCrew = me?.crewStatus != null || session.role === "CREW";
  if (!isCrew && !elevated) redirect("/");

  const t = await getTranslations();
  // Where "back" goes depends on what else this account is (crew-only logins have nowhere else).
  const backHref = elevated ? "/admin" : session.tutorId ? "/dashboard" : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <Link href="/patrol" className="text-lg font-bold text-slate-900">
            {t("crew.brand", { team: TEAM_TITLE })}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
              <p className="muted text-xs">{t("crew.role")}</p>
            </div>
            <ThemeSwitcher />
            <LanguageSwitcher />
            {backHref && (
              <Link href={backHref} className="btn-secondary btn-sm">
                {t("crew.exit")}
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
