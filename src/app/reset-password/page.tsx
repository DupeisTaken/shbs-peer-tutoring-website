import {
  PublicFormPage,
  PublicFormCard,
  PublicFormRoute,
} from "~/app/_components/public-form-page";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata() {
  return pageMetadata("auth.reset.title");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations();

  return (
    <PublicFormPage
      title={t("auth.reset.title")}
      backLabel={t("common.backToMain")}
      footer={
        <PublicFormRoute href="/signin" label={t("auth.reset.backToSignIn")} />
      }
    >
      <PublicFormCard>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-slate-700">{t("auth.reset.missingToken")}</p>
            <PublicFormRoute
              href="/forgot-password"
              label={t("auth.reset.requestLink")}
            />
          </div>
        )}
      </PublicFormCard>
    </PublicFormPage>
  );
}
