import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { RegisterFlow } from "./register-flow";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { auth } from "~/server/auth";
import { cookies } from "next/headers";

export async function generateMetadata() {
  return pageMetadata("auth.register.title");
}

/**
 * All invitation sources converge here. Keep the public viewer and tutee routes
 * visible so visitors without a code can find the right starting point.
 */
export default async function RegisterPage({
  searchParams,
}: { searchParams?: Promise<{ invitation?: string; code?: string }> } = {}) {
  const [t, features, params, session] = await Promise.all([
    getTranslations(),
    getFeatures(db),
    searchParams,
    auth(),
  ]);
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
      headerTitle={headerTitle}
      header={signedInHeader ?? undefined}
      title={t("accountInvitation.pageTitle")}
      backLabel={t("common.backToMain")}
      footer={
        signedIn ? undefined : (
          <div className="space-y-4">
            {features.VIEWER_SIGNUP && (
              <PublicFormRoute
                href="/viewer"
                label={t("auth.signupRoutes.viewerLink")}
              >
                {t("auth.signupRoutes.viewerHelp")}
              </PublicFormRoute>
            )}
            <PublicFormRoute href="/tutee" label={t("survey.requestTutor")}>
              {t("auth.signupRoutes.tuteeHelp")}
            </PublicFormRoute>
            <div className="border-t border-slate-200 pt-4">
              <PublicFormRoute
                href="/signin"
                label={t("auth.register.backToSignIn")}
              />
            </div>
          </div>
        )
      }
    >
      <PublicFormCard>
        <RegisterFlow
          key={params?.invitation ?? "staff-key"}
          invitationId={params?.invitation}
          initialCode={params?.code?.slice(0, 12)}
          initialProof={
            params?.invitation
              ? (await cookies()).get(`invitation-${params.invitation}`)?.value
              : undefined
          }
          signedIn={signedIn}
          viewerSignupAvailable={features.VIEWER_SIGNUP}
        />
      </PublicFormCard>
    </PublicFormPage>
  );
}
