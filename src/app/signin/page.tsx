import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { SESSION_RECOVERY_COOKIE } from "~/lib/session-recovery";
import { SignInForm } from "./sign-in-form";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  // Already signed in — send them home (which routes to the right area by role).
  const session = await auth();
  if (session?.user) redirect("/");

  const [t, features] = await Promise.all([getTranslations(), getFeatures(db)]);
  const expired =
    (await searchParams).reason === "session-expired" ||
    (await cookies()).has(SESSION_RECOVERY_COOKIE);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <FloatingLanguageSwitcher />
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.signinTitle")}
        </h1>
        <p className="muted mt-1">{t("auth.signinSubtitle")}</p>
        {expired && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
          >
            {t("auth.sessionExpired")}
          </p>
        )}
        <div className="card mt-6 p-6 text-left">
          <SignInForm />
          <p className="mt-4 text-sm">
            <Link href="/signup" className="link">
              {t("survey.requestTutor")}
            </Link>
          </p>
          {/* Name each signup destination explicitly: viewers never receive invitations. */}
          <div className="mt-4 flex flex-col items-start gap-2 text-sm">
            <Link
              href="/register"
              className="link inline-flex min-h-11 items-center"
            >
              {t("auth.signupRoutes.invitationLink")}
            </Link>
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
            <Link
              href="/forgot-password"
              className="link inline-flex min-h-11 items-center"
            >
              {t("auth.forgotPassword")}
            </Link>
          </div>
        </div>
        <p className="mt-6">
          <Link href="/" className="link">
            {t("common.backToMain")}
          </Link>
        </p>
      </div>
    </main>
  );
}
