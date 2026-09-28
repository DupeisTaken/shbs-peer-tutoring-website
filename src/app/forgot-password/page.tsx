import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata() {
  return brandingMetadata("Forgot password");
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations();
  return (
    <PublicFormPage
      title={t("auth.forgot.title")}
      description={t("auth.forgot.intro")}
      backLabel={t("common.backToMain")}
      footer={
        <PublicFormRoute href="/signin" label={t("auth.forgot.backToSignIn")} />
      }
    >
      <PublicFormCard>
        <ForgotPasswordForm />
      </PublicFormCard>
    </PublicFormPage>
  );
}
