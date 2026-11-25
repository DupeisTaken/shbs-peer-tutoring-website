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
  const [t, survey] = await Promise.all([
    getTranslations("signupAppeal"),
    getTranslations("survey"),
  ]);
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/tutee",
    title: t("title"),
  });
  return (
    <PublicFormPage
      title={t("title")}
      description={t("help")}
      backLabel={survey("back")}
      backHref="/tutee"
      header={signedInHeader ?? undefined}
    >
      <SignupAppeal />
    </PublicFormPage>
  );
}
