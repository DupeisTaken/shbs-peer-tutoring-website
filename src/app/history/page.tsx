import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { PersonalTuteeHistory } from "./personal-history";
import { PersonalTutorHistory } from "./personal-tutor-history";
import { WorkspaceLinks } from "~/app/_components/workspace-links";
import { SignOutButton } from "~/app/_components/sign-out-button";
import { PublicPageNavigation } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { pageMetadata } from "~/server/branding-metadata";

export async function generateMetadata() {
  return pageMetadata("tuteeHistory.myHistory");
}

/** Past attendance remains accessible without accepting current participation policies. */
export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2Fhistory");
  const [t, tc] = await Promise.all([
    getTranslations("tuteeHistory"),
    getTranslations("common"),
  ]);
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/history",
    title: t("myHistory"),
    containerClassName: "mx-auto max-w-5xl",
    session,
  });
  return (
    <div className="min-h-screen">
      {signedInHeader ?? (
        <PublicPageNavigation
          backLabel={t("back")}
          skipLabel={tc("skipToContent")}
        />
      )}
      <main
        id="main-content"
        className="public-form mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-10"
      >
        {!signedInHeader && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <WorkspaceLinks
              items={[{ href: "/my-account", label: t("settings") }]}
            />
            <SignOutButton className="btn-secondary btn-sm min-h-11 lg:min-h-8 lg:py-0" />
          </div>
        )}
        <header>
          <h1 className="page-title">{t("myHistory")}</h1>
          <p className="muted mt-2">{t("personalHelp")}</p>
        </header>
        <PersonalTuteeHistory />
        <PersonalTutorHistory />
      </main>
    </div>
  );
}
