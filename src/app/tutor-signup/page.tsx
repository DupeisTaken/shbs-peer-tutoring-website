import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { TutorSignupForm } from "./tutor-signup-form";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { auth } from "~/server/auth";

export async function generateMetadata() {
  return pageMetadata("public.tutorSignup.title");
}

export default async function TutorSignupPage() {
  const [t, session] = await Promise.all([getTranslations(), auth()]);
  const signedIn = Boolean(session?.user);
  const headerTitle = t("components.workspaceTitles.signupForms");
  const signedInHeader = signedIn
    ? await getSignedInWorkspaceHeader({
        href: "/",
        title: headerTitle,
        session,
      })
    : null;
  return (
    <PublicFormPage
      wide
      headerTitle={headerTitle}
      header={signedInHeader ?? undefined}
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

      {!signedIn && (
        <p className="muted mt-6 text-center">
          {t("public.tutorSignup.alreadyTutor")}{" "}
          <Link href="/signin" className="link">
            {t("public.tutorSignup.signIn")}
          </Link>
        </p>
      )}
    </PublicFormPage>
  );
}
