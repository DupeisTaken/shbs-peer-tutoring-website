"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ChoiceButton, Button } from "~/app/_components/ui/button";
import { FilterToolbar } from "~/app/_components/ui/patterns";
import type {
  HelpArticle,
  HelpAudience,
  HelpCategory,
  HelpLocale,
  HelpText,
} from "~/lib/help/types";
import { helpCategory, helpCopy } from "./copy";

/** Only server-authorized records arrive here. Search never imports the full
 * repository catalogue into a client bundle or treats a filter as permission. */
export function HelpCatalogue({
  articles,
  audienceTitles,
  locale,
}: {
  articles: HelpArticle[];
  audienceTitles: Partial<Record<HelpAudience, HelpText>>;
  locale: HelpLocale;
}) {
  const copy = helpCopy[locale];
  const id = useId();
  const [search, setSearch] = useState("");
  const [audience, setAudience] = useState<HelpAudience | "all">("all");
  const [category, setCategory] = useState<HelpCategory | "all">("all");
  const audiences = Object.keys(audienceTitles) as HelpAudience[];
  const categories = (Object.keys(copy.categoriesMap) as HelpCategory[]).filter(
    (key) => articles.some((article) => helpCategory(article) === key),
  );
  const filtered = useMemo(() => {
    const terms = search
      .normalize("NFKC")
      .toLocaleLowerCase(locale)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return articles.filter((article) => {
      if (audience !== "all" && article.audience !== audience) return false;
      if (category !== "all" && helpCategory(article) !== category)
        return false;
      const text = [
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
      return terms.every((term) => text.includes(term));
    });
  }, [articles, audience, category, search, locale]);
  const reset = () => {
    setSearch("");
    setAudience("all");
    setCategory("all");
  };
  const active = Boolean(search || audience !== "all" || category !== "all");

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-4 sm:p-5">
        <FilterToolbar
          label={copy.search}
          summary={
            <span role="status" aria-live="polite">
              {filtered.length} {copy.of} {articles.length} {copy.results}
            </span>
          }
          actions={
            active ? (
              <Button size="compact" onClick={reset}>
                {copy.reset}
              </Button>
            ) : undefined
          }
        >
          <div className="min-w-0 flex-1 basis-72">
            <label htmlFor={`${id}-search`} className="label">
              {copy.search}
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.searchHint}
              className="input w-full"
            />
          </div>
        </FilterToolbar>
        <fieldset className="min-w-0 border-t border-slate-100 pt-3">
          <legend className="px-1 text-sm font-semibold text-slate-700">
            {copy.audience}
          </legend>
          <div className="flex flex-wrap gap-2">
            <ChoiceButton
              selected={audience === "all"}
              onClick={() => setAudience("all")}
            >
              {copy.allAudiences}
            </ChoiceButton>
            {audiences.map((item) => (
              <ChoiceButton
                key={item}
                selected={audience === item}
                onClick={() => setAudience(item)}
              >
                {audienceTitles[item]?.[locale]}
              </ChoiceButton>
            ))}
          </div>
        </fieldset>
        <div
          role="group"
          aria-label={copy.categories}
          className="flex flex-wrap gap-2 border-t border-slate-100 pt-4"
        >
          <ChoiceButton
            selected={category === "all"}
            onClick={() => setCategory("all")}
          >
            {copy.allCategories}
          </ChoiceButton>
          {categories.map((key) => (
            <ChoiceButton
              key={key}
              selected={category === key}
              onClick={() => setCategory(key)}
            >
              {copy.categoriesMap[key]}
            </ChoiceButton>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <section
          className="card p-6 text-center"
          aria-labelledby={`${id}-empty`}
        >
          <h2 id={`${id}-empty`} className="section-title">
            {copy.empty}
          </h2>
          <p className="mt-2 text-sm text-slate-600">{copy.emptyHelp}</p>
          <Button onClick={reset} className="mt-4">
            {copy.reset}
          </Button>
        </section>
      ) : (
        categories.map((key) => {
          const group = filtered.filter(
            (article) => helpCategory(article) === key,
          );
          return group.length ? (
            <section
              key={key}
              aria-labelledby={`${id}-${key}`}
              className="space-y-3"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 id={`${id}-${key}`} className="section-title">
                  {copy.categoriesMap[key]}
                </h2>
                <span className="text-sm text-slate-600">{group.length}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {group.map((article) => (
                  <article
                    key={article.slug}
                    className="card flex min-w-0 flex-col p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <span className="badge-slate">
                        {audienceTitles[article.audience]?.[locale]}
                      </span>
                      <span>
                        {article.steps.length} {copy.steps}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900">
                      <Link
                        prefetch={false}
                        href={`/help/${article.slug}`}
                        className="link"
                      >
                        {article.title[locale]}
                      </Link>
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                      {article.summary[locale]}
                    </p>
                    <Link
                      prefetch={false}
                      href={`/help/${article.slug}`}
                      className="link mt-3 inline-flex min-h-11 items-center self-start text-sm lg:min-h-8"
                      aria-label={`${copy.open}: ${article.title[locale]}`}
                    >
                      {copy.open}{" "}
                      <span aria-hidden="true" className="ml-2">
                        →
                      </span>
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          ) : null;
        })
      )}
    </div>
  );
}
