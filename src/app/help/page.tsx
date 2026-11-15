import Link from "next/link";
import { getLocale } from "next-intl/server";
import { helpArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import { helpLocale } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { HelpCatalogue } from "./catalogue";
import { helpCopy } from "./copy";

export default async function HelpPage() {
  const [rawLocale, access] = await Promise.all([getLocale(), getHelpAccess()]);
  const locale = helpLocale(rawLocale);
  const copy = helpCopy[locale];
  const articles = helpArticles.filter((article) =>
    access.audiences.includes(article.audience),
  );
  const audienceTitles = Object.fromEntries(
    access.audiences
      .filter((audience) =>
        articles.some((article) => article.audience === audience),
      )
      .map((audience) => [audience, helpAudienceTitles[audience]]),
  );
  return (
    <main
      lang={locale}
      className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-10"
    >
      <section className="card border-accent-200 p-5 sm:p-7">
        <p className="text-accent-700 text-sm font-semibold">{copy.subtitle}</p>
        <h1 className="page-title mt-2">{copy.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
          {copy.intro}
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {access.audiences.includes("account") ? copy.access : copy.guest}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {!access.audiences.includes("account") && (
            <Link href="/signin?callbackUrl=%2Fhelp" className="btn-primary min-h-11">
              {copy.signIn}
            </Link>
          )}
          {access.canDownload && (
            <Link href="/admin/help" className="btn-secondary min-h-11">
              {copy.downloads}
            </Link>
          )}
          <a
            href="https://github.com/DupeisTaken/shbs-peer-tutoring-website/tree/main/docs/guides/help"
            className="link inline-flex min-h-11 items-center text-sm"
          >
            {copy.source}
          </a>
        </div>
      </section>
      {rawLocale !== "en" && rawLocale !== "zh" && (
        <p
          role="status"
          className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700"
        >
          {copy.fallback}
        </p>
      )}
      <HelpCatalogue
        articles={articles}
        audienceTitles={audienceTitles}
        locale={locale}
      />
    </main>
  );
}
