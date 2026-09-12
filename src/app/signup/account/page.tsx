import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StudentRegistration } from "../student-registration";
import { auth } from "~/server/auth";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

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
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <FloatingLanguageSwitcher />
      <Link className="link text-sm" href="/signup">
        {t("back")}
      </Link>
      <div className="my-8">
        <h1 className="page-title">{t("accountTitle")}</h1>
        <p className="muted mt-2">{t("priority")}</p>
      </div>
      <StudentRegistration
        token={token ?? ""}
        signedInEmail={session?.user.email ?? null}
      />
    </main>
  );
}
