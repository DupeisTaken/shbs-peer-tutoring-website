import { getScreenshotCaption } from "~/lib/help/screenshot-copy";
import {
  getScreenshotSource,
  type HelpScreenshot,
} from "~/lib/help/screenshots";
import type { HelpLocale, HelpStep } from "~/lib/help/types";
import { captureDate, helpCopy } from "./copy";
import { annotationLabels } from "./screenshot-annotations";

export function ScreenshotCaption({
  screenshot,
  step,
  locale,
  originalHref,
}: {
  screenshot: HelpScreenshot;
  step: HelpStep;
  locale: HelpLocale;
  originalHref?: string;
}) {
  const caption = getScreenshotCaption(step, screenshot, locale);
  const source = getScreenshotSource(screenshot);
  const labels = annotationLabels[locale];
  const language =
    screenshot.locale === "zh"
      ? helpCopy[locale].chinese
      : helpCopy[locale].english;
  return (
    <figcaption className="border-t border-slate-200 px-4 text-xs leading-6 text-slate-600 sm:px-5">
      {caption && <p className="pt-3">{caption}</p>}
      {screenshot.locale !== locale && <p className="pt-2">{language}</p>}
      <details>
        <summary className="min-h-11 w-fit cursor-pointer py-2.5">
          {labels.details}
        </summary>
        <div className="space-y-1 pb-3">
          {screenshot.state && !caption && <p>{screenshot.state[locale]}</p>}
          <p>
            {screenshot.locale === locale && `${language} · `}
            {screenshot.route} · {captureDate(screenshot.capturedAt, locale)}
          </p>
          <p>
            {labels.source} ·{" "}
            <code className="break-all">{source.revision}</code> ·{" "}
            {source.label}
          </p>
          {originalHref && (
            <a
              href={originalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="link inline-flex min-h-11 items-center"
            >
              {labels.original}
            </a>
          )}
        </div>
      </details>
    </figcaption>
  );
}
