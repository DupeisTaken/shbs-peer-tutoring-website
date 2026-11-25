import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { ViewerSignupFlow } from "./viewer-signup-flow";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { auth } from "~/server/auth";

export async function generateMetadata() {
  return pageMetadata("accountInvitation.requestTitle");
}

export default async function ViewerSignupPage() {
  // Viewer registration off -> no public signup.
  const features = await getFeatures(db);
  if (!features.VIEWER_SIGNUP) redirect("/");

  const [t, session] = await Promise.all([getTranslations(), auth()]);
  const signedIn = Boolean(session?.user);
  const signedInHeader = signedIn
    ? await getSignedInWorkspaceHeader({
        href: "/viewer-signup",
        title: t("accountInvitation.requestTitle"),
        session,
      })
    : null;
  return (
    <PublicFormPage
      title={t("accountInvitation.requestTitle")}
      description={t("accountInvitation.requestHelp")}
      backLabel={t("common.backToMain")}
      header={signedInHeader ?? undefined}
      footer={
        <div className="space-y-4">
          <PublicFormRoute
            href="/register"
            label={t("auth.signupRoutes.invitationLink")}
          >
            {t("auth.signupRoutes.invitationHelp")}
          </PublicFormRoute>
          <PublicFormRoute href="/tutee" label={t("survey.requestTutor")}>
            {t("auth.signupRoutes.tuteeHelp")}
          </PublicFormRoute>
          {!signedIn && (
            <div className="border-t border-slate-200 pt-4">
              <p className="text-slate-600">
                {t("public.viewerSignup.alreadyHave")}
              </p>
              <PublicFormRoute
                href="/signin"
                label={t("public.viewerSignup.signIn")}
              />
            </div>
          )}
        </div>
      }
    >
      <PublicFormCard>
        <ViewerSignupFlow signedIn={signedIn} />
      </PublicFormCard>
    </PublicFormPage>
  );
}
