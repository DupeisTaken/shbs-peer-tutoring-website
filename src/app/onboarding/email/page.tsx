import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";
import { OnboardingForm } from "./onboarding-form";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export async function generateMetadata() {
  return brandingMetadata("Confirm your email");
}

/**
 * First-login gate for an unverified email or a required password change. Both conditions
 * must be cleared before leaving this page, matching the tutor layout. Mailbox proof and
 * password setup happen through the existing emailed recovery link; 2FA stays unchanged.
 */
export default async function OnboardingEmailPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerifiedAt: true, mustChangePassword: true },
  });

  const isElevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";
  if (user?.emailVerifiedAt && !user.mustChangePassword) redirect(isElevated ? "/admin" : "/dashboard");

  const t = await getTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <FloatingLanguageSwitcher />
      <div className="w-full max-w-sm text-center">
        <span className="badge-slate mb-3">
          {t("auth.onboarding.welcome", { appTitle: APP_TITLE })}
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          {t("auth.onboarding.title")}
        </h1>
        <p className="muted mt-1">{t("auth.onboarding.intro")}</p>
        <div className="card mt-6 p-6 text-left">
          <OnboardingForm
            defaultEmail={user?.email ?? ""}
          />
        </div>
      </div>
    </main>
  );
}
