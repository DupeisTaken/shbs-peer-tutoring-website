import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { PersonalTuteeHistory } from "./personal-history";
import { PersonalTutorHistory } from "./personal-tutor-history";
import { LanguageSwitcher } from "~/app/_components/language-switcher";
import { WorkspaceLinks } from "~/app/_components/workspace-links";
import { SignOutButton } from "~/app/_components/sign-out-button";

/** Past attendance remains accessible without accepting current participation policies. */
export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fhistory");
  const t = await getTranslations("tuteeHistory");
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 py-8 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <WorkspaceLinks
          items={[{ href: "/my-account", label: t("settings") }]}
        />
        <div className="flex items-center gap-2">
          <LanguageSwitcher compactAtDesktop />
          <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
        </div>
      </header>
      <Link className="link inline-flex min-h-11 items-center" href="/">
        {t("back")}
      </Link>
      <div>
        <h1 className="page-title">{t("myHistory")}</h1>
        <p className="muted mt-2">{t("personalHelp")}</p>
      </div>
      <PersonalTuteeHistory />
      <PersonalTutorHistory />
    </main>
  );
}
