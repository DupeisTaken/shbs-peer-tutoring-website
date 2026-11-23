import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicHeader } from "~/app/_components/public-header";

export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  return (
    <div className="min-h-screen">
      <PublicHeader
        navigation={
          <nav aria-label={t("helpNav.title")} className="flex flex-wrap gap-3">
            <Link
              href="/help"
              className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
            >
              {t("helpNav.title")}
            </Link>
            <Link
              href="/"
              className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
            >
              {t("common.backToMain")}
            </Link>
          </nav>
        }
      />
      {children}
    </div>
  );
}
