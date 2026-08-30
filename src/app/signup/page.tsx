import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignupForm } from "./signup-form";
import { SignupOpeningNotice } from "./signup-opening-notice";
import { APP_TITLE } from "~/lib/branding";
import { isSignupWindowOpen } from "~/lib/signup-window";
import { db } from "~/server/db";
import { getActivePeriodOrNull } from "~/server/period";
import { FloatingLanguageSwitcher } from "~/app/_components/floating-language-switcher";

export const metadata = {
  title: `Request a tutor · ${APP_TITLE}`,
};

// This page depends on both current database configuration and the wall clock at request time.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const t = await getTranslations();
  const period = await getActivePeriodOrNull(db);
  const now = new Date();
  const waitingPeriod =
    period?.signupOpensAt && !isSignupWindowOpen(period.signupOpensAt, now)
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
        {period && (
          <p className="mt-2">
            <span className="badge-slate">
              {t("public.signup.term", { term: `${period.schoolYear} ${period.semester}` })}
            </span>
          </p>
        )}
        <p className="muted mt-2">{t("public.signup.intro")}</p>
      </div>

      {waitingPeriod ? (
        <SignupOpeningNotice
          quarter={waitingPeriod.quarter}
          opensAt={waitingPeriod.signupOpensAt.toISOString()}
          previewUrl={waitingPeriod.signupPreviewUrl}
          serverNow={now.toISOString()}
        />
      ) : (
        <SignupForm />
      )}
    </main>
  );
}
