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
  const resolved = views
    .map(({ id, view }) => ({
      id,
      view,
      screenshot: getHelpScreenshot(id, locale),
    }))
    .filter(
      (
        entry,
      ): entry is {
        id: string;
        view: number;
        screenshot: NonNullable<ReturnType<typeof getHelpScreenshot>>;
      } => entry.screenshot !== undefined,
    );
  if (!resolved.length) {
    if (!step.screenshot) {
      return (
        <div>
          <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-5">
            {copy.screenshotMissing}
          </p>
        </div>
      );
    }
    // Screenshots are baked in GitHub Actions runners rather than committed to Git.
    return null;
  }
  return (
    <div>
      {resolved.map(({ id, view, screenshot }) => {
        const imageHref = `/api/help/images/${id}?locale=${locale}`;
        const annotatedHref = `/help/${slug}/screenshots/${number}${view === 1 ? "" : `?view=${view}`}`;
        const frameStep = stepForCaptureView(step, view);
        const viewLabel = `${locale === "zh" ? "视图" : "View"} ${view}`;
        const linkLabel = `${imageCopy.open} · ${step.title[locale]}${resolved.length > 1 ? ` · ${viewLabel}` : ""}`;
        return (
          <figure key={id} className="border-t border-slate-200 bg-slate-50/80">
            {resolved.length > 1 && (
              <p className="px-4 pt-3 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase sm:px-5">
                {viewLabel}
              </p>
            )}
            <div className="px-3 pt-3 pb-1 sm:px-4 sm:pt-4">
              <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
                <AnnotatedScreenshot
                  step={frameStep}
                  screenshot={screenshot}
                  locale={locale}
                  src={imageHref}
                  href={annotatedHref}
                  alt=""
                  linkLabel={linkLabel}
                />
              </div>
            </div>
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
