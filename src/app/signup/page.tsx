import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { SignupForm } from "./signup-form";
import { db } from "~/server/db";
import { readPublicSignupTransition } from "~/server/program/public-signup-transition";
import { PublicFormPage } from "~/app/_components/public-form-page";

export async function generateMetadata() {
  return brandingMetadata("Request a tutor");
}

// This page depends on both current database configuration and the wall clock at request time.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const t = await getTranslations();
  const transition = await readPublicSignupTransition(db);

  return (
    <PublicFormPage
      wide
      title={t("public.signup.title")}
      backLabel={t("common.backToMain")}
      description={<p>{t("survey.intro")}</p>}
    >
      <div className="mt-6">
        <SignupForm initialTransition={transition} />
      </div>
    </PublicFormPage>
  );
}
