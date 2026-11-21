import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  helpArticles,
  helpAudienceTitles,
  helpAudiences,
} from "~/lib/help/catalogue";
import { helpLocale } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { helpCopy } from "~/app/help/copy";

export default async function HelpDownloadsPage() {
  const [rawLocale, access] = await Promise.all([getLocale(), getHelpAccess()]);
  if (!access.canDownload) notFound();
  const locale = helpLocale(rawLocale);
  const copy = helpCopy[locale];
  // Staff can distribute participant training editions without acquiring those
  // memberships. Management authority editions keep their independent gates.
  const audiences = helpAudiences.filter(
    (audience) =>
      ((audience !== "head" && audience !== "admin") ||
        access.audiences.includes(audience)) &&
      helpArticles.some((article) => article.audience === audience),
  );
  return (
    <div lang={locale} className="space-y-6">
      <header>
        <h1 className="page-title">{copy.downloads}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          {copy.downloadsHelp}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          {copy.handbookHelp}
        </p>
        <Link
          href="/help"
          className="link mt-3 inline-flex min-h-11 items-center text-sm"
        >
          {copy.catalogue}
        </Link>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        {audiences.map((audience) => (
          <section
            key={audience}
            className="card p-4 sm:p-5"
            aria-labelledby={`handbook-${audience}`}
          >
            <h2 id={`handbook-${audience}`} className="section-title">
              {helpAudienceTitles[audience][locale]}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {
                helpArticles.filter((article) => article.audience === audience)
                  .length
              }{" "}
              {locale === "en"
                ? helpArticles.filter(
                    (article) => article.audience === audience,
                  ).length === 1
                  ? "guide"
                  : "guides"
                : "篇指南"}
            </p>
            <div
              className="mt-4 flex flex-wrap gap-3"
              role="group"
              aria-label={`${helpAudienceTitles[audience][locale]} — ${copy.pdfLanguage}`}
            >
              <a
                href={`/api/help/pdf/${audience}?locale=en`}
                className="btn-secondary inline-flex min-h-11 items-center"
                download
              >
                {copy.download} · English
              </a>
              <a
                href={`/api/help/pdf/${audience}?locale=zh`}
                className="btn-secondary inline-flex min-h-11 items-center"
                download
              >
                {copy.download} · 中文
              </a>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
