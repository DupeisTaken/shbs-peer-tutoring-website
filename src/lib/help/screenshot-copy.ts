import {
  getHelpScreenshot,
  getStepCallouts,
  getStepCaptureViews,
  stepForCaptureView,
  type HelpScreenshot,
} from "./screenshots";
import type { HelpLocale, HelpStep } from "./types";

function copyKey(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function stepCopy(step: HelpStep, locale: HelpLocale) {
  return [
    step.title[locale],
    step.body[locale],
    ...step.body[locale].split(/(?<=[.!?。！？])\s*|[\r\n]+/u),
  ].map(copyKey);
}

export function getDisplayCallouts(
  step: HelpStep,
  screenshot: HelpScreenshot,
  locale: HelpLocale,
) {
  const labels = new Set<string>();
  const targets = new Set<string>();
  return getStepCallouts(step, screenshot).filter((callout) => {
    const label = copyKey(callout.label[locale]);
    const { x, y, width, height } =
      callout.boundsByLocale?.[screenshot.locale] ?? callout.bounds;
    const target = [x, y, width, height].join(",");
    if (callout.omitFromGuide || labels.has(label) || targets.has(target))
      return false;
    labels.add(label);
    targets.add(target);
    return true;
  });
}

export function getStepFocus(step: HelpStep, locale: HelpLocale) {
  const focus = step.focus?.[locale];
  if (!focus || stepCopy(step, locale).includes(copyKey(focus))) return;
  const repeatedByCallout = getStepCaptureViews(step).some(({ id, view }) => {
    const screenshot = getHelpScreenshot(id, locale);
    return (
      screenshot &&
      getDisplayCallouts(
        stepForCaptureView(step, view),
        screenshot,
        locale,
      ).some((callout) => copyKey(callout.label[locale]) === copyKey(focus))
    );
  });
  return repeatedByCallout ? undefined : focus;
}

/** State records describe capture evidence. Publish only authored captions that add context. */
export function getScreenshotCaption(
  step: HelpStep,
  screenshot: HelpScreenshot,
  locale: HelpLocale,
) {
  const caption = screenshot.caption?.[locale];
  const repeated = [
    ...stepCopy(step, locale),
    copyKey(step.focus?.[locale]),
    ...getDisplayCallouts(step, screenshot, locale).map((callout) =>
      copyKey(callout.label[locale]),
    ),
  ];
  return caption?.trim() && !repeated.includes(copyKey(caption))
    ? caption.trim()
    : undefined;
}
