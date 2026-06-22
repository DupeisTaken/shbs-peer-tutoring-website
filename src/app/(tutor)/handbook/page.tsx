import { getLocale, getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { localizedPolicy } from "~/server/policy";
import { Markdown } from "~/app/_components/markdown";

/**
 * Tutor-facing read-only view of the tutor policy/handbook, in the active UI locale (English
 * fallback). The same admin-edited document shown in the application agreement modal.
 */
export default async function HandbookPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const policy = await localizedPolicy(db, "tutor-policy", locale);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {policy ? (
        <>
          <h1 className="page-title mb-4">{policy.title}</h1>
          <div className="card p-6 text-sm leading-relaxed text-slate-700">
            <Markdown>{policy.body}</Markdown>
          </div>
        </>
      ) : (
        <p className="muted">{t("tutor.handbook.empty")}</p>
      )}
    </main>
  );
}
