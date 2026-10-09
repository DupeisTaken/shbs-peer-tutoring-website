import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";
import { hasReadyCredentials } from "~/lib/account-readiness";
import { OnboardingForm } from "./onboarding-form";
import {
  PublicFormPage,
  PublicFormCard,
} from "~/app/_components/public-form-page";

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
    select: {
      email: true,
      emailVerifiedAt: true,
      mustChangePassword: true,
      passwordHash: true,
    },
  });

  const isElevated =
    session.role === "HEAD" ||
    session.role === "ADMIN" ||
    session.role === "COORDINATOR";
  if (user && hasReadyCredentials(user))
    redirect(isElevated ? "/admin" : "/dashboard");

  const t = await getTranslations();

  return (
    <PublicFormPage
      title={t("auth.onboarding.title")}
      description={t("auth.onboarding.intro")}
      backLabel={t("common.backToMain")}
      notice={
        <p className="text-center text-sm text-slate-600">
          {t("auth.onboarding.welcome", { appTitle: APP_TITLE })}
        </p>
      }
    >
      <PublicFormCard>
        <OnboardingForm defaultEmail={user?.email ?? ""} />
      </PublicFormCard>
    </PublicFormPage>
  );
}
