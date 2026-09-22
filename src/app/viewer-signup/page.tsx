import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { ViewerSignupFlow } from "./viewer-signup-flow";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return brandingMetadata("Follow the program");
}

export default async function ViewerSignupPage() {
  // Viewer registration off -> no public signup.
  const features = await getFeatures(db);
  if (!features.VIEWER_SIGNUP) redirect("/");

  const t = await getTranslations();
  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-12">
      <FloatingLanguageSwitcher />
      <Link href="/" className="link text-sm">
        {t("common.backToMain")}
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">{t("public.viewerSignup.title")}</h1>
        <p className="muted mt-2">{t("public.viewerSignup.intro")}</p>
      </div>

      <ViewerSignupFlow />

      {/* Invitations and tutoring requests create different access from a read-only viewer. */}
      <div className="mt-6 space-y-3 text-sm">
        <p>
          {t("auth.signupRoutes.invitationHelp")}{" "}
          <Link
            href="/register"
            className="link inline-flex min-h-11 items-center"
          >
            {t("auth.signupRoutes.invitationLink")}
          </Link>
        </p>
        <p>
          {t("auth.signupRoutes.tuteeHelp")}{" "}
          <Link
            href="/signup"
            className="link inline-flex min-h-11 items-center"
          >
            {t("survey.requestTutor")}
          </Link>
        </p>
      </div>

      <p className="muted mt-6 text-center">
        {t("public.viewerSignup.alreadyHave")}{" "}
        <Link href="/signin" className="link">
          {t("public.viewerSignup.signIn")}
        </Link>
      </p>
    </main>
  );
}
