import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CrewSignupForm } from "./crew-signup-form";
import { APP_TITLE } from "~/lib/branding";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export const metadata = {
  title: `Join the crew · ${APP_TITLE}`,
};

export default async function CrewSignupPage() {
  // Crew module off -> no public crew application.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const t = await getTranslations();
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <FloatingLanguageSwitcher />
      <Link href="/" className="link text-sm">
        {t("common.backToMain")}
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">{t("public.crewSignup.title")}</h1>
        <p className="muted mt-2">{t("public.crewSignup.intro")}</p>
      </div>

      <CrewSignupForm />

      <p className="muted mt-6 text-center">
        {t("public.crewSignup.alreadyMember")}{" "}
        <Link href="/signin" className="link">
          {t("public.crewSignup.signIn")}
        </Link>
      </p>
    </main>
  );
}
