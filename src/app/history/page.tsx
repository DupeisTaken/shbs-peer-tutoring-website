import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { PersonalTuteeHistory } from "./personal-history";
import { PublicPageNavigation } from "~/app/_components/public-form-page";

/** Past attendance remains accessible without accepting current participation policies. */
export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fhistory");
  const t = await getTranslations("tuteeHistory");
  return (
    <div className="min-h-screen">
      <PublicPageNavigation backLabel={t("back")} />
      <main className="public-form mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-10">
        <header>
          <h1 className="page-title">{t("myHistory")}</h1>
          <p className="muted mt-2">{t("personalHelp")}</p>
        </header>
        <PersonalTuteeHistory />
      </main>
    </div>
  );
}
