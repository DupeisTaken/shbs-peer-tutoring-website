import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { RegisterFlow } from "./register-flow";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return brandingMetadata("Register");
}

/**
 * Invited members redeem a staff-issued registration code. Keep the public viewer and
 * tutee routes visible so visitors without an invitation can find the right starting point.
 */
export default async function RegisterPage() {
  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <FloatingLanguageSwitcher />
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.register.title")}
        </h1>
        <p className="muted mt-1">{t("auth.register.subtitle")}</p>
        <div className="card mt-6 p-6 text-left">
          <RegisterFlow />
        </div>
        <div className="mt-6 space-y-3 text-left text-sm">
          {features.VIEWER_SIGNUP && (
            <p>
              {t("auth.signupRoutes.viewerHelp")}{" "}
              <Link
                href="/viewer-signup"
                className="link inline-flex min-h-11 items-center"
              >
                {t("auth.signupRoutes.viewerLink")}
              </Link>
            </p>
          )}
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
        <p className="mt-6">
          <Link href="/signin" className="link">
            {t("auth.register.backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
