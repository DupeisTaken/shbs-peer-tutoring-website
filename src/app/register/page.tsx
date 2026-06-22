import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { APP_TITLE } from "~/lib/branding";
import { RegisterFlow } from "./register-flow";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export const metadata = {
  title: `Register · ${APP_TITLE}`,
};

/**
 * Public self-registration. A tutor turns the 6-digit security key an admin handed them into a
 * verified account. No login is required to reach this page (see middleware PUBLIC list).
 */
export default async function RegisterPage() {
  const t = await getTranslations();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <FloatingLanguageSwitcher />
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.register.title")}
        </h1>
        <p className="muted mt-1">{t("auth.register.subtitle")}</p>
        <div className="card mt-6 p-6 text-left">
          <RegisterFlow />
        </div>
        <p className="mt-6">
          <Link href="/signin" className="link">
            {t("auth.register.backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
