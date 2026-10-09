import { getTranslations } from "next-intl/server";
import { StudentRegistration } from "../student-registration";
import { auth } from "~/server/auth";
import { PublicFormPage } from "~/app/_components/public-form-page";

export const metadata = {
  title: "Confirm Tutee Signup",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function StudentAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, t, session] = await Promise.all([
    searchParams,
    getTranslations("survey"),
    auth(),
  ]);
  return (
    <PublicFormPage
      title={t("accountTitle")}
      description={t("priority")}
      backLabel={t("back")}
      wide
    >
      <StudentRegistration
        token={token ?? ""}
        signedInEmail={session?.user.email ?? null}
      />
    </PublicFormPage>
  );
}
