import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { helpArticles, helpAudienceTitles } from "~/lib/help/catalogue";
import {
  getLocalizedReleaseRef,
  helpCaptureInfo,
} from "~/lib/help/screenshots";
import { getStepFocus } from "~/lib/help/screenshot-copy";
import { helpLocale } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { captureDate, helpCopy } from "../copy";
import { StepScreenshotGallery } from "../step-screenshot-gallery";

/** The page guard runs before article text, related links or screenshots render.
 * An unavailable article is indistinguishable from an unknown slug. */
export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, rawLocale, access] = await Promise.all([
    params,
    getLocale(),
    getHelpAccess(),
  ]);
  const article = helpArticles.find((item) => item.slug === slug);
  if (!article || !access.audiences.includes(article.audience)) notFound();
  const locale = helpLocale(rawLocale);
  const copy = helpCopy[locale];
  const related = helpArticles.filter(
    (item) =>
      article.related?.includes(item.slug) &&
      access.audiences.includes(item.audience),
  );
  const contents = [
    { id: "before", title: copy.before },
    { id: "walkthrough", title: copy.walkthrough },
    { id: "expected", title: copy.expected },
    { id: "explanation", title: copy.explanation },
    { id: "troubleshooting", title: copy.troubleshooting },
  ];

  return (
    <main lang={locale} className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <Link
        href="/help"
        className="link inline-flex min-h-11 items-center text-sm"
      >
        ← {copy.catalogue}
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <aside className="self-start lg:sticky lg:top-28">
          <nav
            aria-label={copy.contents}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <p className="text-sm font-semibold text-slate-900">
              {copy.contents}
            </p>
            <ol className="mt-2 space-y-1">
              {contents.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="link inline-flex min-h-11 items-center text-sm lg:min-h-8"
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <article
          aria-labelledby="guide-title"
          className="max-w-3xl min-w-0 space-y-7"
        >
          <header className="border-b border-slate-200 pb-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="badge-slate">
                {helpAudienceTitles[article.audience][locale]}
              </span>
              <span>
                {article.steps.length} {copy.steps}
              </span>
            </div>
            <h1 id="guide-title" className="page-title mt-3">
              {article.title[locale]}
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-600">
              {article.summary[locale]}
            </p>
            {article.requiresPrivateLink ? (
              <p className="border-accent-200 bg-accent-50 text-accent-950 mt-4 rounded-lg border px-4 py-3 text-sm leading-6">
                {copy.privateLinkHint}
              </p>
            ) : article.externalAction ? (
              <a
                href={article.externalAction.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-4 inline-flex min-h-11 max-w-full items-center"
              >
                {article.externalAction.label[locale]}
              </a>
            ) : (
              <Link
                prefetch={false}
                href={article.route}
                className="btn-primary mt-4 inline-flex min-h-11 items-center"
              >
                {copy.openPage}
              </Link>
            )}
            {rawLocale !== "en" && rawLocale !== "zh" && (
              <p role="status" className="mt-3 text-sm text-slate-600">
                {copy.fallback}
              </p>
            )}
          </header>

          <section
            id="before"
            className="card scroll-mt-40 p-4 sm:p-5"
            aria-labelledby="before-title"
          >
            <h2 id="before-title" className="section-title">
              {copy.before}
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
              {article.prerequisites.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          </section>

          <section
            id="walkthrough"
            className="scroll-mt-40"
            aria-labelledby="walkthrough-title"
          >
            <h2 id="walkthrough-title" className="section-title">
              {copy.walkthrough}
            </h2>
            <ol className="mt-4 space-y-5">
              {article.steps.map((step, index) => {
                const focus = getStepFocus(step, locale);
                return (
                  <li
                    key={index}
                    id={`step-${index + 1}`}
                    className="card scroll-mt-40 overflow-hidden"
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="bg-accent-100 text-accent-800 grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <h3 className="pt-1 text-base font-semibold text-slate-900">
                            <span className="sr-only">{index + 1}. </span>
                            {step.title[locale]}
                          </h3>
                          <p className="mt-2 text-sm leading-7 text-slate-700">
                            {step.body[locale]}
                          </p>
                        </div>
                      </div>
                      {focus && (
                        <p className="border-accent-200 bg-accent-50 text-accent-950 mt-4 rounded-lg border px-3 py-2 text-sm leading-6">
                          <strong>{copy.focus}: </strong>
                          {focus}
                        </p>
                      )}
                    </div>
                    <StepScreenshotGallery
                      slug={article.slug}
                      step={step}
                      number={index + 1}
                      locale={locale}
                    />
                  </li>
                );
              })}
            </ol>
          </section>

          <section
            id="expected"
            className="scroll-mt-40 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:p-5"
            aria-labelledby="expected-title"
          >
            <h2 id="expected-title" className="section-title text-emerald-950">
              {copy.expected}
            </h2>
            <p className="mt-2 text-sm leading-7 text-emerald-950">
              {article.expected[locale]}
            </p>
          </section>
          <section
            id="explanation"
            className="scroll-mt-40"
            aria-labelledby="explanation-title"
          >
            <h2 id="explanation-title" className="section-title">
              {copy.explanation}
            </h2>
            {article.explanation.map((item, index) => (
              <p key={index} className="mt-3 text-sm leading-7 text-slate-700">
                {item[locale]}
              </p>
            ))}
          </section>
          <section
            id="troubleshooting"
            className="card scroll-mt-40 p-4 sm:p-5"
            aria-labelledby="troubleshooting-title"
          >
            <h2 id="troubleshooting-title" className="section-title">
              {copy.troubleshooting}
            </h2>
            <dl className="mt-3 divide-y divide-slate-200">
              {article.troubleshooting.map((item, index) => (
                <div key={index} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm font-semibold text-slate-900">
                    {item.problem[locale]}
                  </dt>
                  <dd className="mt-1 text-sm leading-7 text-slate-700">
                    {item.solution[locale]}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-600">
              {copy.support}
            </p>
          </section>

          {related.length > 0 && (
            <section aria-labelledby="related-title">
              <h2 id="related-title" className="section-title">
                {copy.related}
              </h2>
              <ul className="mt-2">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/help/${item.slug}`}
                      prefetch={false}
                      className="link inline-flex min-h-11 items-center text-sm"
                    >
                      {item.title[locale]}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold lg:min-h-8">
              {copy.provenance}
            </summary>
            <p className="mt-3 leading-6">{copy.provenanceHelp}</p>
            <dl className="mt-3 space-y-2 text-xs leading-5 break-words">
              <div>
                <dt className="font-semibold">{copy.revision}</dt>
                <dd>
                  <a
                    className="link"
                    href={`https://github.com/DupeisTaken/shbs-peer-tutoring-website/commit/${helpCaptureInfo.sourceRevision}`}
                  >
                    {helpCaptureInfo.sourceRevision}
                  </a>
                </dd>
              </div>
              {helpCaptureInfo.releaseRef && (
                <div>
                  <dt className="font-semibold">{copy.release}</dt>
                  <dd>{getLocalizedReleaseRef(locale)}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold">{copy.captured}</dt>
                <dd>{captureDate(helpCaptureInfo.capturedAt, locale)}</dd>
              </div>
            </dl>
          </details>
        </article>
      </div>
    </main>
  );
}
