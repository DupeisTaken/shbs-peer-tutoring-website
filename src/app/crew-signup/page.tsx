import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { CrewSignupForm } from "./crew-signup-form";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return brandingMetadata("Join the crew");
}

export default async function CrewSignupPage() {
  // Crew module off -> no public crew application.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const t = await getTranslations();
  return (
    <PublicFormPage
      wide
      title={t("public.crewSignup.title")}
      description={t("public.crewSignup.intro")}
      backLabel={t("common.backToMain")}
    >
      <CrewSignupForm />

      <p className="muted mt-6 text-center">
        {t("public.crewSignup.alreadyMember")}{" "}
        <Link href="/signin" className="link">
          {t("public.crewSignup.signIn")}
        </Link>
      </p>
    </PublicFormPage>
  );
}
