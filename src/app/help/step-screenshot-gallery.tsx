import {
  getHelpScreenshot,
  getStepCaptureViews,
  stepForCaptureView,
} from "~/lib/help/screenshots";
import type { HelpLocale, HelpStep } from "~/lib/help/types";
import { AnnotatedScreenshot } from "./annotated-screenshot";
import { ScreenshotCaption } from "./screenshot-caption";
import { annotationLabels } from "./screenshot-annotations";
import { helpCopy } from "./copy";

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
        const frameStep = stepForCaptureView(step, view);
        const viewLabel = `${locale === "zh" ? "视图" : "View"} ${view}`;
        const linkLabel = `${imageCopy.open} · ${step.title[locale]}${views.length > 1 ? ` · ${viewLabel}` : ""}`;
        return (
          <figure key={id} className="border-t border-slate-200 bg-slate-50">
            {views.length > 1 && (
              <p className="px-4 py-3 text-sm font-semibold text-slate-800 sm:px-5">
                {viewLabel}
              </p>
            )}
            <AnnotatedScreenshot
              step={frameStep}
              screenshot={screenshot}
              locale={locale}
              src={imageHref}
              href={annotatedHref}
              alt=""
              linkLabel={linkLabel}
            />
            <ScreenshotCaption
              screenshot={screenshot}
              step={frameStep}
              locale={locale}
              originalHref={imageHref}
            />
          </figure>
        );
      })}
    </div>
  );
}
