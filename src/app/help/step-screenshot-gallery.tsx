import {
  getHelpScreenshot,
  getScreenshotSource,
  getStepCaptureViews,
  stepForCaptureView,
} from "~/lib/help/screenshots";
import type { HelpLocale, HelpStep } from "~/lib/help/types";
import { AnnotatedScreenshot } from "./annotated-screenshot";
import { annotationLabels } from "./screenshot-annotations";
import { captureDate, helpCopy } from "./copy";

export function StepScreenshotGallery({
  slug,
  step,
  number,
  locale,
}: {
  slug: string;
  step: HelpStep;
  number: number;
  locale: HelpLocale;
}) {
  const views = getStepCaptureViews(step);
  const copy = helpCopy[locale];
  const imageCopy = annotationLabels[locale];
  return (
    <div>
      {!step.screenshot && (
        <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-5">
          {copy.screenshotMissing}
        </p>
      )}
      {views.map(({ id, view }) => {
        const screenshot = getHelpScreenshot(id, locale);
        if (!screenshot)
          return (
            <p
              key={id}
              className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-5"
            >
              {copy.screenshotMissing}
            </p>
          );
        const imageHref = `/api/help/images/${id}?locale=${locale}`;
        const annotatedHref = `/help/${slug}/screenshots/${number}${view === 1 ? "" : `?view=${view}`}`;
        const source = getScreenshotSource(screenshot);
        return (
          <figure key={id} className="border-t border-slate-200 bg-slate-50">
            {views.length > 1 && (
              <p className="px-4 py-3 text-sm font-semibold text-slate-800 sm:px-5">
                {locale === "zh" ? "视图" : "View"} {view}
              </p>
            )}
            <AnnotatedScreenshot
              step={stepForCaptureView(step, view)}
              screenshot={screenshot}
              locale={locale}
              src={imageHref}
              href={annotatedHref}
              legendId={`step-${number}-view-${view}-callouts`}
              alt={
                screenshot.caption?.[locale] ??
                screenshot.state?.[locale] ??
                step.focus?.[locale] ??
                step.title[locale]
              }
              linkLabel={`${imageCopy.annotated}: ${step.title[locale]} (${view})`}
            />
            <figcaption className="space-y-1 border-t border-slate-200 px-4 py-3 text-xs leading-5 text-slate-600 sm:px-5">
              <p className="font-medium text-slate-700">
                {screenshot.caption?.[locale] ?? step.title[locale]}
              </p>
              {screenshot.state && <p>{screenshot.state[locale]}</p>}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span>
                  {screenshot.locale === "zh" ? copy.chinese : copy.english} ·{" "}
                  {screenshot.route} ·{" "}
                  {captureDate(screenshot.capturedAt, locale)}
                </span>
                <div className="flex flex-wrap gap-x-4">
                  <a
                    href={annotatedHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link inline-flex min-h-11 items-center lg:min-h-8"
                  >
                    {imageCopy.annotated}
                  </a>
                  <a
                    href={imageHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link inline-flex min-h-11 items-center lg:min-h-8"
                  >
                    {imageCopy.original}
                  </a>
                </div>
              </div>
              <p>
                {imageCopy.source}:{" "}
                <code className="break-all">{source.revision}</code> · {source.label}
              </p>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
