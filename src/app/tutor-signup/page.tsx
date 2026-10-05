import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { TutorSignupForm } from "./tutor-signup-form";
import { PublicFormPage } from "~/app/_components/public-form-page";

export async function generateMetadata() {
  return brandingMetadata("Become a tutor");
}

export default async function TutorSignupPage() {
  const t = await getTranslations();
  return (
    <PublicFormPage
      wide
      title={t("public.tutorSignup.title")}
      description={t("public.tutorSignup.intro")}
      backLabel={t("common.backToMain")}
    >
      <ol
        aria-label={t("public.tutorSignup.journey.title")}
        className="mb-6 grid gap-3 sm:grid-cols-3"
      >
        {(["apply", "interview", "register"] as const).map((step, index) => (
          <li
            key={step}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-sm font-semibold text-slate-900">
              {index + 1}. {t(`public.tutorSignup.journey.${step}`)}
            </p>
            <p className="muted mt-1">
              {t(`public.tutorSignup.journey.${step}Help`)}
            </p>
          </li>
        ))}
      </ol>
      <TutorSignupForm />

      <p className="muted mt-6 text-center">
        {t("public.tutorSignup.alreadyTutor")}{" "}
        <Link href="/signin" className="link">
          {t("public.tutorSignup.signIn")}
        </Link>
      </p>
    </PublicFormPage>
  );
}
