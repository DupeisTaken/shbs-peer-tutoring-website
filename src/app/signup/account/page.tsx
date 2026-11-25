import { getTranslations } from "next-intl/server";
import { StudentRegistration } from "../student-registration";
import { auth } from "~/server/auth";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";

export const metadata = {
  title: "Confirm Tutee Signup",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function StudentAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; intent?: string }>;
}) {
  const [{ token, intent }, rootT, session] = await Promise.all([
    searchParams,
    getTranslations(),
    auth(),
  ]);
  const headerTitle = rootT("components.workspaceTitles.signupForms");
  const signedInHeader = session?.user
    ? await getSignedInWorkspaceHeader({
        href: "/",
        title: headerTitle,
        session,
      })
    : null;
  return (
    <PublicFormPage
      headerTitle={headerTitle}
      header={signedInHeader ?? undefined}
      title={rootT("survey.accountTitle")}
      description={rootT("survey.priority")}
      backLabel={rootT("survey.back")}
      backHref="/tutee"
      wide
    >
      <StudentRegistration
        key={intent ?? token ?? "missing-token"}
        token={token ?? ""}
        intentId={intent}
        signedInEmail={session?.user.email ?? null}
      />
    </PublicFormPage>
  );
}
