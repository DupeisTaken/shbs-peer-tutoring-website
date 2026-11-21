import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { helpArticles } from "~/lib/help/catalogue";
import {
  getHelpScreenshot,
  getScreenshotSource,
  getStepCaptureViews,
  stepForCaptureView,
} from "~/lib/help/screenshots";
import { helpLocale } from "~/lib/help/types";
import { getHelpAccess } from "~/server/help/access";
import { AnnotatedScreenshot } from "../../../annotated-screenshot";
import { annotationLabels } from "../../../screenshot-annotations";
import { captureDate, helpCopy } from "../../../copy";

/** Resolve the live article allowlist before returning a full-size image view.
 * The underlying unchanged JPEG also retains its separate protected route. */
export default async function HelpStepScreenshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; step: string }>;
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const [requested, rawLocale, access, query] = await Promise.all([
    params,
    getLocale(),
    getHelpAccess(),
    searchParams ?? Promise.resolve({} as { view?: string | string[] }),
  ]);
  const article = helpArticles.find((item) => item.slug === requested.slug);
  if (!article || !access.audiences.includes(article.audience)) notFound();
  if (!/^[1-9]\d*$/.test(requested.step)) notFound();
  const stepNumber = Number(requested.step);
  if (!Number.isSafeInteger(stepNumber) || stepNumber > article.steps.length)
    notFound();
  const step = article.steps[stepNumber - 1]!;
  const viewNumber =
    query.view === undefined
      ? 1
      : typeof query.view === "string" && /^[1-9]\d*$/.test(query.view)
        ? Number(query.view)
        : Number.NaN;
  if (!Number.isSafeInteger(viewNumber)) notFound();
  const views = getStepCaptureViews(step);
  const selected = views.find((view) => view.view === viewNumber);
  if (!selected) notFound();
  const locale = helpLocale(rawLocale);
  const screenshot = getHelpScreenshot(selected.id, locale);
  if (!screenshot) notFound();
  const copy = annotationLabels[locale];
  const source = getScreenshotSource(screenshot);
  const rawHref = `/api/help/images/${screenshot.id}?locale=${locale}`;
  return (
    <main lang={locale} className="mx-auto max-w-[1600px] space-y-5 px-4 py-6">
      <header className="space-y-3">
        <Link
          href={`/help/${article.slug}#step-${stepNumber}`}
          className="link inline-flex min-h-11 items-center"
        >
          ← {copy.back}
        </Link>
        <p className="text-sm text-slate-600">
          {article.title[locale]} · {stepNumber}
        </p>
        <h1 className="page-title">{step.title[locale]}</h1>
        <p className="max-w-3xl text-sm leading-7 text-slate-700">
          {step.body[locale]}
        </p>
        <p className="text-sm leading-6 text-slate-600">{copy.pan}</p>
        {views.length > 1 && (
          <nav
            aria-label={
              locale === "zh" ? "本步骤截图" : "Screenshots for this step"
            }
            className="flex flex-wrap gap-2"
          >
            {views.map((view) => (
              <Link
                key={view.view}
                prefetch={false}
                href={`/help/${article.slug}/screenshots/${stepNumber}${view.view === 1 ? "" : `?view=${view.view}`}`}
                aria-current={view.view === viewNumber ? "page" : undefined}
                className="btn-secondary inline-flex min-h-11 items-center"
              >
                {locale === "zh" ? "视图" : "View"} {view.view}
              </Link>
            ))}
          </nav>
        )}
        <a
          href={rawHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex min-h-11 items-center"
        >
          {copy.original}
        </a>
      </header>
      <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div
          className="overflow-auto"
          tabIndex={0}
          role="region"
          aria-label={copy.annotated}
        >
          <div style={{ width: screenshot.viewport.width }}>
            <AnnotatedScreenshot
              step={stepForCaptureView(step, viewNumber)}
              screenshot={screenshot}
              locale={locale}
              src={rawHref}
              alt={
                screenshot.caption?.[locale] ??
                step.focus?.[locale] ??
                step.title[locale]
              }
              legendId="full-screenshot-callouts"
            />
          </div>
        </div>
        <figcaption className="space-y-2 border-t border-slate-200 p-4 text-xs leading-6 text-slate-600">
          {screenshot.state && <p>{screenshot.state[locale]}</p>}
          <p>
            {screenshot.locale === "zh"
              ? helpCopy[locale].chinese
              : helpCopy[locale].english}{" "}
            · {screenshot.route} · {captureDate(screenshot.capturedAt, locale)}
          </p>
          <p>
            {copy.source}: <code className="break-all">{source.revision}</code> ·{" "}
            {source.label}
          </p>
        </figcaption>
      </figure>
    </main>
  );
}
