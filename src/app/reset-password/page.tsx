import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { APP_TITLE } from "~/lib/branding";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: `Reset password · ${APP_TITLE}`,
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.reset.title")}
        </h1>
        <div className="card mt-6 p-6 text-left">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-slate-700">{t("auth.reset.missingToken")}</p>
              <Link href="/forgot-password" className="link">
                {t("auth.reset.requestLink")}
              </Link>
            </div>
          )}
        </div>
        <p className="mt-6">
          <Link href="/signin" className="link">
            {t("auth.reset.backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
