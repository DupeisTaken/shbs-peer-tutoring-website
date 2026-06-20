import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignupForm } from "./signup-form";
import { APP_TITLE } from "~/lib/branding";

export const metadata = {
  title: `Request a tutor · ${APP_TITLE}`,
};

export default async function SignupPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <Link href="/" className="link text-sm">
        {t("common.backToMain")}
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">{t("public.signup.title")}</h1>
        <p className="muted mt-2">{t("public.signup.intro")}</p>
      </div>

      <SignupForm />
    </main>
  );
}
