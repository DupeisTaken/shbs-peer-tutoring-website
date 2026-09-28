import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { SESSION_RECOVERY_COOKIE } from "~/lib/session-recovery";
import { SignInForm } from "./sign-in-form";
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
  const reason = (await searchParams).reason;
  const passwordChanged = reason === "password-changed";
  const expired =
    reason === "session-expired" ||
    (await cookies()).has(SESSION_RECOVERY_COOKIE);

  return (
    <PublicFormPage
      title={t("auth.signinTitle")}
      description={t("auth.signinSubtitle")}
      backLabel={t("common.backToMain")}
      notice={
        (expired || passwordChanged) && (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm leading-6 text-amber-950"
          >
            {t(
              passwordChanged
                ? "auth.passwordChangedSignIn"
                : "auth.sessionExpired",
            )}
          </p>
        )
      }
      footer={
        <div className="space-y-4">
          <div className="flex flex-wrap justify-center gap-x-5">
            <PublicFormRoute href="/signup" label={t("survey.requestTutor")} />
            <PublicFormRoute
              href="/register"
              label={t("auth.signupRoutes.invitationLink")}
            />
          </div>
          {features.VIEWER_SIGNUP && (
            <div className="border-t border-slate-200 pt-4">
              <PublicFormRoute
                href="/viewer-signup"
                label={t("auth.signupRoutes.viewerLink")}
              >
                {t("auth.signupRoutes.viewerHelp")}
              </PublicFormRoute>
            </div>
          )}
        </div>
      }
    >
      <PublicFormCard>
        <SignInForm />
        <div className="mt-3 text-center">
          <PublicFormRoute
            href="/forgot-password"
            label={t("auth.forgotPassword")}
          />
        </div>
      </PublicFormCard>
    </PublicFormPage>
  );
}
