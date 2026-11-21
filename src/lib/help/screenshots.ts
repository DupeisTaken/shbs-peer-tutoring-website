import captures from "../../../docs/guides/help/captures.json";
import type { HelpCallout, HelpLocale, HelpStep, HelpText } from "./types";
import { validatePublishedCaptureRoute } from "./capture-route";

export type HelpScreenshot = {
  id: string;
  file: string;
  route: string;
  locale: HelpLocale;
  capturedAt: string;
  viewport: { width: number; height: number };
  /** A full-page frame can extend beyond the visible CSS browser viewport. */
  captureMode?: "viewport" | "full-page";
  /** Actual CSS browser viewport, including any native scrollbar excluded by a provider's bitmap. */
  browserViewport?: { width: number; height: number };
  crop?: { x: number; y: number; width: number; height: number };
  original?: { sha256: string; width: number; height: number };
  caption?: HelpText;
  role: string;
  sha256: string;
  /** A mixed capture set retains each image's exact baseline and attestation. */
  sourceRevision?: string;
  sourceLabel?: string;
  state?: HelpText;
  stepBinding?: {
    guide: string;
    step: number;
    title: HelpText;
    directionsSha256: string;
  };
  /** Reviewed targets on the untouched full image; annotations are derived overlays. */
  callouts?: HelpCallout[];
};

export const helpCaptureInfo = captures.info;
/** Validate at the shared read boundary so a mistyped caption cannot reach the
 * website or fail much later while exporting a different language edition. */
export function validateScreenshotState(capture: {
  id: string;
  locale: string;
  state?: unknown;
}) {
  if (capture.state === undefined) return; // Historical overview captions are optional.
  const state = capture.state;
  if (
    !state ||
    typeof state !== "object" ||
    !("en" in state) ||
    typeof state.en !== "string" ||
    !state.en.trim() ||
    !("zh" in state) ||
    typeof state.zh !== "string" ||
    !state.zh.trim()
  )
    throw new Error(
      `Screenshot state requires English and Chinese: ${capture.id}:${capture.locale}`,
    );
}
// Validate before any caller serializes the complete metadata array (including
// offline training reports). Authoring flags must never bypass URL privacy.
export const helpScreenshots = (captures.screenshots as HelpScreenshot[]).map(
  (capture) => {
    validatePublishedCaptureRoute(capture.route);
    validateScreenshotState(capture);
    return capture;
  },
);

export function getHelpScreenshot(id: string, locale = "en") {
  return (
    helpScreenshots.find((item) => item.id === id && item.locale === locale) ??
    helpScreenshots.find((item) => item.id === id && item.locale === "en")
  );
}

export function getStepCallouts(step: HelpStep, screenshot: HelpScreenshot) {
  return step.callouts ?? screenshot.callouts ?? [];
}

export function getStepCaptureViews(step: HelpStep) {
  return [step.screenshot, ...(step.supplementaryScreenshots ?? [])].flatMap(
    (id, index) => (id ? [{ id, view: index + 1 }] : []),
  );
}

/** A primary-frame override must never move a supplemental frame's targets. */
export function stepForCaptureView(step: HelpStep, view: number): HelpStep {
  return view === 1 ? step : { ...step, callouts: undefined };
}

export function getScreenshotSource(screenshot: HelpScreenshot) {
  return {
    revision: screenshot.sourceRevision ?? helpCaptureInfo.sourceRevision,
    label: screenshot.sourceLabel ?? helpCaptureInfo.releaseRef,
  };
}
