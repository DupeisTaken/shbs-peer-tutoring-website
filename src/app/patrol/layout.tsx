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
    session.role === "HEAD" || session.role === "ADMIN" || session.role === "COORDINATOR";
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
        {/* Keep language beside the brand on mobile and workspace links on their own row.
            Existing compact props align every desktop control without changing shared shells. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:flex lg:flex-wrap lg:gap-3 lg:px-6">
          <Link href="/patrol" className="flex min-h-11 items-center text-xl font-bold text-slate-900 lg:mr-auto lg:min-h-8 lg:text-lg">
            {t("crew.brand", { team: TEAM_TITLE })}
          </Link>
          <div className="justify-self-end lg:order-3">
            <LanguageSwitcher compactAtDesktop />
          </div>
          <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 sm:gap-3 lg:order-2">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">{session.user.name}</p>
              <p className="muted text-xs">{t("crew.role")}</p>
            </div>
            <ThemeSwitcher compactAtDesktop />
            <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 lg:order-1 lg:border-0 lg:pt-0">
            <Link href="/student" prefetch={false} className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0">
              {t("components.userMenu.enterTutee")}
            </Link>
            {backHref && (
              <Link href={backHref} className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0">
                {t("crew.exit")}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
