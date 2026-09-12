import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { TutorSignupForm } from "./tutor-signup-form";
import { APP_TITLE } from "~/lib/branding";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export const metadata = {
  title: `Become a tutor · ${APP_TITLE}`,
};

export default async function TutorSignupPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <FloatingLanguageSwitcher />
      <Link href="/" className="link text-sm">
        {t("common.backToMain")}
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">{t("public.tutorSignup.title")}</h1>
        <p className="muted mt-2">{t("public.tutorSignup.intro")}</p>
      </div>

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
    </main>
  );
}
