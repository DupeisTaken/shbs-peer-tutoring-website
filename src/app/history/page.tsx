import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { PersonalTuteeHistory } from "./personal-history";

/** Past attendance remains accessible without accepting current participation policies. */
export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fhistory");
  const t = await getTranslations("tuteeHistory");
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 py-8 sm:p-8">
      <Link className="link inline-flex min-h-11 items-center" href="/">
        {t("back")}
      </Link>
      <div>
        <h1 className="page-title">{t("myHistory")}</h1>
        <p className="muted mt-2">{t("personalHelp")}</p>
      </div>
      <PersonalTuteeHistory />
    </main>
  );
}
