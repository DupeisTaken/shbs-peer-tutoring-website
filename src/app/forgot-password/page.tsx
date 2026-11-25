import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata() {
  return pageMetadata("auth.forgot.title");
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations();
  const emailAvailable = isEmailDeliveryAvailable("SECURITY");
  const signedInHeader = await getSignedInWorkspaceHeader({
    href: "/forgot-password",
    title: t("auth.forgot.title"),
  });
  return (
    <PublicFormPage
      title={t("auth.forgot.title")}
      description={t("auth.forgot.intro")}
      backLabel={t("common.backToMain")}
      header={signedInHeader ?? undefined}
      footer={
        signedInHeader ? undefined : (
          <PublicFormRoute
            href="/signin"
            label={t("auth.forgot.backToSignIn")}
          />
        )
      }
    >
      <PublicFormCard>
        <ForgotPasswordForm
          emailAvailable={emailAvailable}
          signedIn={Boolean(signedInHeader)}
        />
      </PublicFormCard>
    </PublicFormPage>
  );
}
