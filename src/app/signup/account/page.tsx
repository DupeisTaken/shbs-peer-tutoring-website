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
  const [{ token, intent }, t, session] = await Promise.all([
    searchParams,
    getTranslations("survey"),
    auth(),
  ]);
  const signedInHeader = session?.user
    ? await getSignedInWorkspaceHeader({
        href: "/tutee-signup/account",
        title: t("accountTitle"),
        session,
      })
    : null;
  return (
    <PublicFormPage
      title={t("accountTitle")}
      description={t("priority")}
      backLabel={t("back")}
      backHref="/tutee"
      header={signedInHeader ?? undefined}
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
