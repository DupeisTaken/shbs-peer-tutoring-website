import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { RegisterFlow } from "./register-flow";
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
    <PublicFormPage
      title={t("auth.register.title")}
      description={t("auth.register.subtitle")}
      backLabel={t("common.backToMain")}
      footer={
        <div className="space-y-4">
          {features.VIEWER_SIGNUP && (
            <PublicFormRoute
              href="/viewer-signup"
              label={t("auth.signupRoutes.viewerLink")}
            >
              {t("auth.signupRoutes.viewerHelp")}
            </PublicFormRoute>
          )}
          <PublicFormRoute href="/signup" label={t("survey.requestTutor")}>
            {t("auth.signupRoutes.tuteeHelp")}
          </PublicFormRoute>
          <div className="border-t border-slate-200 pt-4">
            <PublicFormRoute
              href="/signin"
              label={t("auth.register.backToSignIn")}
            />
          </div>
        </div>
      }
    >
      <PublicFormCard>
        <RegisterFlow />
      </PublicFormCard>
    </PublicFormPage>
  );
}
