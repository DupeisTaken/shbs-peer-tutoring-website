import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { SignupForm } from "./signup-form";
import { SignupOpeningNotice } from "./signup-opening-notice";
import { recruitmentStatus, recruitmentWindow } from "~/lib/recruitment";
import { db } from "~/server/db";
import { getActivePeriodOrNull } from "~/server/period";
import { getFeatures } from "~/server/program/features";
import { getPeriodDisplay } from "~/lib/period";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export async function generateMetadata() {
  return brandingMetadata("Request a tutor");
}

// This page depends on both current database configuration and the wall clock at request time.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const t = await getTranslations();
  const [period, features] = await Promise.all([
    getActivePeriodOrNull(db),
    getFeatures(db),
  ]);
  const displayPeriod =
    period && getPeriodDisplay(period, features.QUARTER_SYSTEM);
  const now = new Date();
  const waitingPeriod =
    period?.signupOpensAt &&
    recruitmentStatus(recruitmentWindow(period, "tutee"), now.getTime()) ===
      "scheduled"
      ? { ...period, signupOpensAt: period.signupOpensAt }
      : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <FloatingLanguageSwitcher />
      <Link href="/" className="link text-sm">
        {t("common.backToMain")}
      </Link>
      <div className="mb-8 text-center">
        <h1 className="page-title">{t("public.signup.title")}</h1>
        {displayPeriod && (
          <p className="mt-2">
            <span className="badge-slate">
              {t(`public.signup.${displayPeriod.kind}`, {
                period: displayPeriod.label,
              })}
            </span>
          </p>
        )}
        <p className="muted mt-2">{t("survey.intro")}</p>
      </div>

      {waitingPeriod ? (
        <SignupOpeningNotice
          periodLabel={
            getPeriodDisplay(waitingPeriod, features.QUARTER_SYSTEM).label
          }
          opensAt={waitingPeriod.signupOpensAt.toISOString()}
          previewUrl={waitingPeriod.signupPreviewUrl}
          serverNow={now.toISOString()}
        />
      ) : null}
      <div className="mt-6">
        <SignupForm />
      </div>
    </main>
  );
}
