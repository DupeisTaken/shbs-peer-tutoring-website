import { createHash } from "node:crypto";
import type { HelpArticle, HelpText } from "../src/lib/help/types";
import type { HelpScreenshot } from "../src/lib/help/screenshots";
import {
  getStepCallouts,
  stepForCaptureView,
  validateScreenshotState,
} from "../src/lib/help/screenshots";
import { layoutHelpCallouts } from "../src/app/help/screenshot-annotations";
import { validatePublishedCaptureRoute } from "../src/lib/help/capture-route";

type ReviewedCapture = HelpScreenshot & {
  review?: { acceptedAt: string; method: string };
};

export function directionsSha256(body: HelpText) {
  return createHash("sha256")
    .update(JSON.stringify({ en: body.en, zh: body.zh }))
    .digest("hex");
}

const bilingual = (value: HelpText | undefined) =>
  typeof value?.en === "string" &&
  !!value.en.trim() &&
  typeof value.zh === "string" &&
  !!value.zh.trim();
const dimensions = (value: { width: number; height: number } | undefined) =>
  !!value &&
  Number.isSafeInteger(value.width) &&
  value.width > 0 &&
  Number.isSafeInteger(value.height) &&
  value.height > 0;

/** Header-only parsing validates bitmap dimensions without decoding/allocating
 * full image pixels or introducing a native image dependency into the CI gate. */
export function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Capture is not a JPEG");
  let offset = 2;
  const uint16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Malformed JPEG segment");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG segment");
    const length = uint16(offset);
    if (length < 2 || offset + length > bytes.length)
      throw new Error("Truncated JPEG segment");
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      if (length < 8) throw new Error("Truncated JPEG frame");
      const result = { width: uint16(offset + 5), height: uint16(offset + 3) };
      if (!dimensions(result)) throw new Error("Invalid JPEG dimensions");
      return result;
    }
    offset += length;
  }
  throw new Error("JPEG frame dimensions are missing");
}

export function validateCaptureReceipt(
  screenshot: HelpScreenshot,
  bytes: Uint8Array,
) {
  const key = `${screenshot.id}:${screenshot.locale}`;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(screenshot.id) ||
    !["en", "zh"].includes(screenshot.locale) ||
    screenshot.file !== `${screenshot.id}.${screenshot.locale}.jpg`
  )
    throw new Error(`Unsafe screenshot identity or filename: ${key}`);
  if (
    !/^[a-f0-9]{64}$/.test(screenshot.sha256) ||
    createHash("sha256").update(bytes).digest("hex") !== screenshot.sha256
  )
    throw new Error(`Screenshot bytes differ from capture receipt: ${key}`);
  const bitmap = jpegDimensions(bytes);
  if (
    !dimensions(screenshot.viewport) ||
    bitmap.width !== screenshot.viewport.width ||
    bitmap.height !== screenshot.viewport.height
  )
    throw new Error(`Screenshot dimensions differ from its bitmap: ${key}`);
  validatePublishedCaptureRoute(screenshot.route);
  validateScreenshotState(screenshot);
  if (
    !screenshot.role?.trim() ||
    !Number.isFinite(Date.parse(screenshot.capturedAt))
  )
    throw new Error(`Incomplete capture provenance: ${key}`);
  if (
    (screenshot.sourceRevision !== undefined &&
      !/^[a-f0-9]{40}$/.test(screenshot.sourceRevision)) ||
    (screenshot.sourceLabel !== undefined && !screenshot.sourceLabel.trim())
  )
    throw new Error(`Invalid per-image source provenance: ${key}`);
}

export function validateStepCaptureCoverage(
  articles: readonly HelpArticle[],
  screenshots: readonly ReviewedCapture[],
  { allowPending = false }: { allowPending?: boolean } = {},
) {
  const missing: string[] = [];
  let illustrated = 0;
  let steps = 0;
  const expectedBindings = new Set<string>();
  for (const article of articles)
    for (const [index, step] of article.steps.entries()) {
      steps++;
      const id = `${article.slug}-step-${index + 1}`;
      const frames = screenshots.filter((capture) => capture.id === id);
      if (!frames.some((capture) => capture.locale === "en")) {
        missing.push(`${id}: ${step.title.en}`);
      } else {
        illustrated++;
        if (step.screenshot !== id)
          throw new Error(
            `Guide step is not bound to its exact capture: ${id}`,
          );
      }
      const supplements = step.supplementaryScreenshots ?? [];
      for (const [offset, supplementalId] of supplements.entries()) {
        if (supplementalId !== `${id}-view-${offset + 2}`)
          throw new Error(
            `Supplementary captures must be unique, ordered views of their exact step: ${supplementalId}`,
          );
      }
      for (const [offset, frameId] of [id, ...supplements].entries()) {
        expectedBindings.add(frameId);
        const frameStep = stepForCaptureView(step, offset + 1);
        const captures =
          offset === 0
            ? frames
            : screenshots.filter((capture) => capture.id === frameId);
        if (offset > 0 && !captures.some((capture) => capture.locale === "en"))
          missing.push(`${frameId}: ${step.title.en}`);
        for (const capture of captures) {
          const key = `${frameId}:${capture.locale}`;
          const binding = capture.stepBinding;
          if (
            !binding ||
            !bilingual(binding.title) ||
            binding.guide !== article.slug ||
            binding.step !== index + 1 ||
            binding.title.en !== step.title.en ||
            binding.title.zh !== step.title.zh ||
            binding.directionsSha256 !== directionsSha256(step.body)
          )
            throw new Error(`Stale or incorrect exact step binding: ${key}`);
          if (capture.crop)
            throw new Error(
              `Step captures must preserve the full viewport: ${key}`,
            );
          if (
            !dimensions(capture.viewport) ||
            !dimensions(capture.browserViewport)
          )
            throw new Error(
              `Step capture needs bitmap and browser viewport dimensions: ${key}`,
            );
          if (
            capture.captureMode !== "viewport" &&
            capture.captureMode !== "full-page"
          )
            throw new Error(
              `Step capture needs its viewport/full-page capture mode: ${key}`,
            );
          const scaleX =
            capture.viewport.width / capture.browserViewport!.width;
          const scaleY =
            capture.viewport.height / capture.browserViewport!.height;
          // Some providers omit the native vertical scrollbar from image pixels.
          // Bound that exception in CSS pixels; a percentage-only relaxation would
          // silently tolerate substantially wider crops on desktop screenshots.
          const missingCssWidth =
            capture.browserViewport!.width - capture.viewport.width / scaleY;
          const omitsOnlyScrollbar =
            missingCssWidth >= 0 && missingCssWidth <= 20;
          // A uniformly scaled bitmap may round either dimension by a pixel.
          // Do not turn that allowance into a percentage crop on large screens.
          const pixelRoundingTolerance = Math.max(
            2 / capture.browserViewport!.width,
            2 / capture.browserViewport!.height,
          );
          if (
            capture.captureMode === "viewport" &&
            !omitsOnlyScrollbar &&
            Math.abs(scaleX - scaleY) > pixelRoundingTolerance
          )
            throw new Error(
              `Step capture aspect differs from the full browser viewport: ${key}`,
            );
          if (capture.captureMode === "full-page" && scaleY < scaleX * 0.965)
            throw new Error(
              `Full-page capture omits part of the visible browser height: ${key}`,
            );
          if (
            !capture.sourceRevision ||
            !/^[a-f0-9]{40}$/.test(capture.sourceRevision) ||
            !capture.sourceLabel?.trim() ||
            !bilingual(capture.state)
          )
            throw new Error(
              `Step capture needs exact per-image source and bilingual state: ${key}`,
            );
          if (
            !capture.review?.method.trim() ||
            !Number.isFinite(Date.parse(capture.capturedAt)) ||
            !Number.isFinite(Date.parse(capture.review.acceptedAt)) ||
            Date.parse(capture.review.acceptedAt) <
              Date.parse(capture.capturedAt)
          )
            throw new Error(
              `Step capture needs a recorded review after capture: ${key}`,
            );
          if (!getStepCallouts(frameStep, capture).length)
            throw new Error(
              `Step capture needs reviewed in-image labels: ${key}`,
            );
          // Resolve both language editions, selecting positions by the actual frame
          // locale. This also catches invalid boxes, crops and labels too tall to fit.
          layoutHelpCallouts(frameStep, capture, "en");
          layoutHelpCallouts(frameStep, capture, "zh");
        }
      }
    }
  for (const capture of screenshots) {
    if (
      (capture.stepBinding ||
        /-step-[1-9]\d*(?:-view-[1-9]\d*)?$/.test(capture.id)) &&
      !expectedBindings.has(capture.id)
    )
      throw new Error(
        `Capture points to a missing or reordered guide step: ${capture.id}`,
      );
  }
  if (missing.length && !allowPending)
    throw new Error(
      `Full step capture coverage is incomplete (${illustrated}/${steps}):\n${missing.slice(0, 20).join("\n")}${missing.length > 20 ? `\n... and ${missing.length - 20} more steps` : ""}\nCapture each actual step; overview reuse or fingerprint refresh cannot satisfy this gate.`,
    );
  return { steps, illustrated, missing };
}
