import { helpArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import type { HelpAudience, HelpLocale } from "~/lib/help/types";
import { helpCopy } from "./copy";

/** Shared offline handbook download cards used on Help Center (everyone's permitted
 * editions) and Management → Administration → PDF handbooks (staff distribution). */
export function HelpHandbookDownloads({
  audiences,
  locale,
  headingLevel = "h2",
}: {
  audiences: HelpAudience[];
  locale: HelpLocale;
  headingLevel?: "h2" | "h3";
}) {
  const copy = helpCopy[locale];
  const Heading = headingLevel;
  const available = audiences.filter((audience) =>
    helpArticles.some((article) => article.audience === audience),
  );
  if (available.length === 0) return null;

  return (
    <div
      className={
        available.length === 1
          ? "grid gap-4 md:max-w-xl"
          : "grid gap-4 md:grid-cols-2"
      }
    >
      {available.map((audience) => {
        const count = helpArticles.filter(
          (article) => article.audience === audience,
        ).length;
        return (
          <section
            key={audience}
            className="card flex flex-col justify-between p-4 sm:p-5"
            aria-labelledby={`handbook-${audience}`}
          >
            <div>
              <Heading id={`handbook-${audience}`} className="section-title">
                {helpAudienceTitles[audience][locale]}
              </Heading>
              <p className="mt-1.5 text-sm text-slate-600">
                {count}{" "}
                {locale === "en" ? (count === 1 ? "guide" : "guides") : "篇指南"}
              </p>
            </div>
            <div
              className="mt-4 flex flex-wrap gap-2.5"
              role="group"
              aria-label={`${helpAudienceTitles[audience][locale]} — ${copy.pdfLanguage}`}
            >
              <a
                href={`/api/help/pdf/${audience}?locale=en`}
                className="btn-secondary inline-flex min-h-11 items-center text-sm lg:min-h-9"
                download
              >
                {copy.download} · English
              </a>
              <a
                href={`/api/help/pdf/${audience}?locale=zh`}
                className="btn-secondary inline-flex min-h-11 items-center text-sm lg:min-h-9"
                download
              >
                {copy.download} · 中文
              </a>
            </div>
          </section>
        );
      })}
    </div>
  );
}
