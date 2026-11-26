import Link from "next/link";
import { getLocale } from "next-intl/server";
import { helpArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import {
  helpLocale,
  type HelpArticle,
  type HelpLocale,
} from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { HelpCatalogue, type HelpCatalogueEntry } from "./catalogue";
import { helpCategory, helpCopy } from "./copy";
import { HelpHandbookDownloads } from "./handbook-downloads";

export function toHelpCatalogueEntry(
  article: HelpArticle,
  locale: HelpLocale,
): HelpCatalogueEntry {
  const searchText = [
    article.title[locale],
    article.summary[locale],
    article.expected[locale],
    article.route,
    ...article.covers,
    ...article.prerequisites.map((item) => item[locale]),
    ...article.steps.flatMap((step) => [
      step.title[locale],
      step.body[locale],
      step.focus?.[locale] ?? "",
    ]),
    ...article.explanation.map((item) => item[locale]),
    ...article.troubleshooting.flatMap((item) => [
      item.problem[locale],
      item.solution[locale],
    ]),
  ]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase(locale);
  return {
    slug: article.slug,
    audience: article.audience,
    category: helpCategory(article),
    title: article.title[locale],
    summary: article.summary[locale],
    stepCount: article.steps.length,
    searchText,
  };
}

export default async function HelpPage() {
  const [rawLocale, access] = await Promise.all([getLocale(), getHelpAccess()]);
  const locale = helpLocale(rawLocale);
  const copy = helpCopy[locale];
  const authorized = helpArticles.filter((article) =>
    access.audiences.includes(article.audience),
  );
  const articles = authorized.map((article) =>
    toHelpCatalogueEntry(article, locale),
  );
  const audienceTitles = Object.fromEntries(
    access.audiences
      .filter((audience) =>
        authorized.some((article) => article.audience === audience),
      )
      .map((audience) => [audience, helpAudienceTitles[audience][locale]]),
  );
  const downloadableAudiences = access.downloadableAudiences.filter((audience) =>
    helpArticles.some((article) => article.audience === audience),
  );
  return (
    <main
      id="main-content"
      lang={locale}
      className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-10 lg:px-6"
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
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!access.audiences.includes("account") && (
            <Link
              href="/signin?callbackUrl=%2Fhelp"
              className="btn-primary min-h-11"
            >
              {copy.signIn}
            </Link>
          )}
          {downloadableAudiences.length > 0 && (
            <a href="#handbooks" className="btn-secondary min-h-11">
              {copy.downloads}
            </a>
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
      {downloadableAudiences.length > 0 && (
        <section
          id="handbooks"
          aria-labelledby="help-handbooks-title"
          className="scroll-mt-28 space-y-4 border-t border-slate-200 pt-6"
        >
          <header className="space-y-1.5">
            <h2 id="help-handbooks-title" className="section-title">
              {copy.downloads}
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              {copy.downloadsHelp}
            </p>
          </header>
          <HelpHandbookDownloads
            audiences={downloadableAudiences}
            locale={locale}
            headingLevel="h3"
          />
        </section>
      )}
    </main>
  );
}
