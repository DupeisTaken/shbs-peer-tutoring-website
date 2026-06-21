import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { SignInForm } from "./sign-in-form";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export default async function SignInPage() {
  // Already signed in — send them home (which routes to the right area by role).
  const session = await auth();
  if (session?.user) redirect("/");

  const t = await getTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <FloatingLanguageSwitcher />
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.signinTitle")}
        </h1>
        <p className="muted mt-1">{t("auth.signinSubtitle")}</p>
        <div className="card mt-6 p-6 text-left">
          <SignInForm />
          <p className="mt-4 text-right text-sm">
            <Link href="/forgot-password" className="link">
              {t("auth.forgotPassword")}
            </Link>
          </p>
        </div>
        <p className="muted mt-6">
          {t("auth.lookingForTutor")}{" "}
          <Link href="/signup" className="link">
            {t("auth.requestOne")}
          </Link>
        </p>
        <p className="mt-2">
          <Link href="/" className="link">
            {t("common.backToMain")}
          </Link>
        </p>
      </div>
    </main>
  );
}
