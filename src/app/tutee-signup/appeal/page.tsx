import { getTranslations } from "next-intl/server";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { SignupAppeal } from "./signup-appeal";

export const metadata = {
  title: "Review Tutee Signup",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

/** This email capability is checked on the server by every read/write. The page
 * never looks up requests by contact email or exposes their submitted answers. */
export default async function SignupAppealPage() {
  const t = await getTranslations();
  const headerTitle = t("components.workspaceTitles.signupForms");
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/",
    title: headerTitle,
  });
  return (
    <PublicFormPage
      headerTitle={headerTitle}
      header={signedInHeader ?? undefined}
      title={t("signupAppeal.title")}
      description={t("signupAppeal.help")}
      backLabel={t("survey.back")}
      backHref="/tutee"
    >
      <SignupAppeal />
    </PublicFormPage>
  );
}
