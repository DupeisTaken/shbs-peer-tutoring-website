import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { pageMetadata } from "~/server/branding-metadata";
import { localizedPolicy } from "~/server/policy";
import { Markdown } from "~/app/_components/markdown";

export async function generateMetadata() {
  return pageMetadata("tutor.nav.handbook");
}

/**
 * Tutor-facing read-only view of the tutor policy/handbook, in the active UI locale (English
 * fallback). The same admin-edited document shown in the application agreement modal.
 */
export default async function HandbookPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const policy = await localizedPolicy(db, "tutor-policy", locale);

  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:py-8 lg:px-6">
      <div className="space-y-1">
        <Link
          href="/dashboard"
          className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
        >
          ← {t("tutor.settings.backToDashboard")}
        </Link>
        <h1 className="page-title">
          {policy?.title ?? t("tutor.nav.handbook")}
        </h1>
      </div>
      {policy ? (
        <div className="card p-6 text-sm leading-relaxed text-slate-700">
          <Markdown>{policy.body}</Markdown>
        </div>
      ) : (
        <p className="muted">{t("tutor.handbook.empty")}</p>
      )}
    </main>
  );
}
