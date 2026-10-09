import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { ViewerSignupFlow } from "./viewer-signup-flow";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { auth } from "~/server/auth";

export async function generateMetadata() {
  return brandingMetadata("Request an account invitation");
}

export default async function ViewerSignupPage() {
  // Viewer registration off -> no public signup.
  const features = await getFeatures(db);
  if (!features.VIEWER_SIGNUP) redirect("/");

  const [t, session] = await Promise.all([getTranslations(), auth()]);
  return (
    <PublicFormPage
      title={t("accountInvitation.requestTitle")}
      description={t("accountInvitation.requestHelp")}
      backLabel={t("common.backToMain")}
      footer={
        <div className="space-y-4">
          <PublicFormRoute
            href="/register"
            label={t("auth.signupRoutes.invitationLink")}
          >
            {t("auth.signupRoutes.invitationHelp")}
          </PublicFormRoute>
          <PublicFormRoute href="/signup" label={t("survey.requestTutor")}>
            {t("auth.signupRoutes.tuteeHelp")}
          </PublicFormRoute>
          <div className="border-t border-slate-200 pt-4">
            <p className="text-slate-600">
              {t("public.viewerSignup.alreadyHave")}
            </p>
            <PublicFormRoute
              href="/signin"
              label={t("public.viewerSignup.signIn")}
            />
          </div>
        </div>
      }
    >
      <PublicFormCard>
        <ViewerSignupFlow signedIn={Boolean(session?.user)} />
      </PublicFormCard>
    </PublicFormPage>
  );
}
