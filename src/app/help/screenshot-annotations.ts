import type { HelpScreenshot } from "~/lib/help/screenshots";
import { getStepCallouts } from "~/lib/help/screenshots";
import { getDisplayCallouts } from "~/lib/help/screenshot-copy";
import type {
  HelpBounds,
  HelpCallout,
  HelpLocale,
  HelpStep,
} from "~/lib/help/types";

export const annotationColors = {
  ink: "#0f172a",
  accent: "#4f46e5",
  outline: "#4f46e5",
  tint: "rgba(79, 70, 229, 0.07)",
  text: "#ffffff",
  backing: "#ffffff",
  frame: "#cbd5e1",
} as const;

export type AnnotationLayout = {
  number: number;
  text: string;
  lines: string[];
  target: HelpBounds;
  label: HelpBounds;
  /** Narrow source frames keep controls visible; their full labels stay in the legend. */
  showLabel: boolean;
  fontSize: number;
  lineHeight: number;
  padding: number;
  badgeSize: number;
  targetBadge: { x: number; y: number; radius: number };
  leader?: { from: { x: number; y: number }; to: { x: number; y: number } };
};

function validBounds(bounds: HelpBounds) {
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= 1.000001 &&
    bounds.y + bounds.height <= 1.000001
  );
}

export function validateHelpCallouts(callouts: HelpCallout[]) {
  if (callouts.length > 12)
    throw new Error("A screenshot supports at most twelve reviewed callouts");
  for (const callout of callouts) {
    if (
      !validBounds(callout.bounds) ||
      Object.values(callout.boundsByLocale ?? {}).some(
        (bounds) => !bounds || !validBounds(bounds),
      )
    )
      throw new Error("Screenshot callout bounds must fit the full image");
    if (
      !["en", "zh"].every((locale) =>
        callout.label[locale as HelpLocale]?.trim(),
      )
    )
      throw new Error("Screenshot callouts require English and Chinese labels");
    if (
      callout.labelPosition &&
      (![callout.labelPosition.x, callout.labelPosition.y].every(
        Number.isFinite,
      ) ||
        callout.labelPosition.x < 0 ||
        callout.labelPosition.y < 0 ||
        callout.labelPosition.x > 1 ||
        callout.labelPosition.y > 1)
    )
      throw new Error("Screenshot label positions must fit the full image");
    if (
      callout.badgePosition !== undefined &&
      (!callout.badgePosition ||
        ![callout.badgePosition.x, callout.badgePosition.y].every(
          Number.isFinite,
        ) ||
        callout.badgePosition.x < 0 ||
        callout.badgePosition.y < 0 ||
        callout.badgePosition.x > 1 ||
        callout.badgePosition.y > 1)
    )
      throw new Error("Screenshot badge positions must fit the full image");
  }
}

const characterWidth = (character: string, size: number) =>
  size *
  (character.codePointAt(0)! > 0x24f
    ? 1
    : /[MWmw@]/.test(character)
      ? 1
      : 0.65);

function wrapLabel(value: string, maximumWidth: number, fontSize: number) {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const token of value.trim().replace(/\s+/gu, " ").split(/(\s+)/u)) {
    const tokenWidth = [...token].reduce(
      (sum, character) => sum + characterWidth(character, fontSize),
      0,
    );
    if (
      line &&
      tokenWidth <= maximumWidth &&
      width + tokenWidth > maximumWidth
    ) {
      lines.push(line.trim());
      line = "";
      width = 0;
    }
    for (const character of token) {
      if (!line && character === " ") continue;
      const next = characterWidth(character, fontSize);
      if (line && width + next > maximumWidth) {
        lines.push(line.trim());
        line = "";
        width = 0;
      }
      line += character;
      width += next;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Clip a connector against the control rectangle. At frame edges the only
 * available badge side may face away from the label; omit that connector rather
 * than draw across the real control's text. Matching numbers still identify it. */
function crossesTarget(
  from: { x: number; y: number },
  to: { x: number; y: number },
  target: HelpBounds,
) {
  let enter = 0;
  let leave = 1;
  for (const [origin, delta, minimum, maximum] of [
    [from.x, to.x - from.x, target.x, target.x + target.width],
    [from.y, to.y - from.y, target.y, target.y + target.height],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const last = (maximum - origin) / delta;
    enter = Math.max(enter, Math.min(first, last));
    leave = Math.min(leave, Math.max(first, last));
    if (enter > leave) return false;
  }
  return true;
}

type Badge = AnnotationLayout["targetBadge"];
const badgeClearance = 2;
const containsTarget = (region: HelpBounds, target: HelpBounds) =>
  region.x <= target.x + 1e-6 &&
  region.y <= target.y + 1e-6 &&
  region.x + region.width >= target.x + target.width - 1e-6 &&
  region.y + region.height >= target.y + target.height - 1e-6 &&
  region.width * region.height > target.width * target.height + 1e-6;
const distanceToTarget = (
  point: { x: number; y: number },
  target: HelpBounds,
) =>
  Math.hypot(
    Math.max(target.x - point.x, 0, point.x - target.x - target.width),
    Math.max(target.y - point.y, 0, point.y - target.y - target.height),
  );

/** A broad highlighted section must not disqualify every badge for a control
 * inside it. Sibling controls remain obstacles, including later callouts. */
function controlObstacles(target: HelpBounds, targets: HelpBounds[]) {
  return targets.filter((other) => !containsTarget(other, target));
}

function safeBadge(
  badge: Badge,
  target: HelpBounds,
  obstacles: HelpBounds[],
  occupied: Badge[],
  width: number,
  height: number,
) {
  return (
    badge.x - badge.radius >= badgeClearance &&
    badge.y - badge.radius >= badgeClearance &&
    badge.x + badge.radius <= width - badgeClearance &&
    badge.y + badge.radius <= height - badgeClearance &&
    distanceToTarget(badge, target) <= badge.radius * 3 + 8 + 1e-6 &&
    obstacles.every(
      (other) =>
        distanceToTarget(badge, other) >= badge.radius + badgeClearance - 1e-6,
    ) &&
    occupied.every(
      (other) =>
        Math.hypot(badge.x - other.x, badge.y - other.y) >=
        badge.radius + other.radius + badgeClearance - 1e-6,
    )
  );
}

function automaticBadge(
  target: HelpBounds,
  label: HelpBounds,
  radius: number,
  showLabel: boolean,
  obstacles: HelpBounds[],
  occupied: Badge[],
  width: number,
  height: number,
) {
  const clampX = (value: number) =>
    Math.max(
      radius + badgeClearance,
      Math.min(value, width - radius - badgeClearance),
    );
  const clampY = (value: number) =>
    Math.max(
      radius + badgeClearance,
      Math.min(value, height - radius - badgeClearance),
    );
  const preferRight = showLabel
    ? label.x + label.width / 2 >= target.x + target.width / 2
    : width - target.x - target.width > target.x;
  const preferBottom = showLabel
    ? label.y + label.height / 2 >= target.y + target.height / 2
    : height - target.y - target.height > target.y;
  const candidates: Badge[] = [];
  // Try the familiar side placement first, then vertical and corner positions.
  // Further rings stay near the same target and resolve tightly packed controls
  // without silently covering a neighbor or stealing a reviewed badge position.
  for (const gap of [6, radius + 8, radius * 2 + 8]) {
    const left = target.x - radius - gap,
      right = target.x + target.width + radius + gap;
    const top = target.y - radius - gap,
      bottom = target.y + target.height + radius + gap;
    for (const x of preferRight ? [right, left] : [left, right])
      candidates.push({ x, y: clampY(target.y + target.height / 2), radius });
    for (const y of preferBottom ? [bottom, top] : [top, bottom]) {
      for (const x of [
        target.x + target.width / 2,
        ...(preferRight
          ? [target.x + target.width - radius, target.x + radius]
          : [target.x + radius, target.x + target.width - radius]),
        ...(preferRight ? [right, left] : [left, right]),
      ])
        candidates.push({ x: clampX(x), y, radius });
    }
  }
  // The target number must remain separate from the pill's own number/text.
  const badgeObstacles = showLabel ? [...obstacles, label] : obstacles;
  const result = candidates.find((badge) =>
    safeBadge(badge, target, badgeObstacles, occupied, width, height),
  );
  if (!result)
    throw new Error(
      "Screenshot badge has no safe space near its target; review the targets or use a clearer frame",
    );
  return result;
}

/** One pixel layout drives HTML/SVG, PDF vectors and derived PNGs. Only the
 * reviewed target comes from data; fitting a label never invents a UI location. */
export function layoutHelpCallouts(
  step: HelpStep,
  screenshot: HelpScreenshot,
  locale: HelpLocale,
  inlineLabels = true,
): AnnotationLayout[] {
  const reviewedCallouts = getStepCallouts(step, screenshot);
  validateHelpCallouts(reviewedCallouts);
  if (
    reviewedCallouts.length &&
    screenshot.crop &&
    screenshot.captureMode !== "cropped"
  )
    throw new Error(
      "Screenshot callouts require the full viewport rather than a presentation crop",
    );
  const { width, height } = screenshot.viewport;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Screenshot dimensions are required for annotations");
  const fontSize = Math.max(16, Math.min(26, width / 60));
  const padding = fontSize * 0.45;
  const badgeSize = fontSize * 1.35;
  const lineHeight = fontSize * 1.3;
  const margin = Math.min(8, width * 0.02, height * 0.02);
  const showLabel = inlineLabels && width >= 600;
  const callouts = getDisplayCallouts(step, screenshot, locale);
  const radius = badgeSize * 0.42;
  // Suppressed callouts still describe real controls to route drawn markers around.
  const targets = reviewedCallouts.map((callout) => {
    const bounds =
      callout.boundsByLocale?.[screenshot.locale] ?? callout.bounds;
    return {
      x: bounds.x * width,
      y: bounds.y * height,
      width: bounds.width * width,
      height: bounds.height * height,
    };
  });
  const reviewed = reviewedCallouts.map((callout) =>
    callout.badgePosition
      ? {
          x: callout.badgePosition.x * width,
          y: callout.badgePosition.y * height,
          radius,
        }
      : undefined,
  );
  const reviewedBadges = reviewed.filter(
    (badge): badge is Badge => badge !== undefined,
  );
  reviewed.forEach((badge, index) => {
    if (
      badge &&
      !safeBadge(
        badge,
        targets[index]!,
        controlObstacles(targets[index]!, targets),
        reviewedBadges.filter((other) => other !== badge),
        width,
        height,
      )
    )
      throw new Error(
        "Reviewed screenshot badge position must be near its target, clear of controls and inside the full image",
      );
  });
  const activeTargets = callouts.map((callout) =>
    reviewedCallouts.indexOf(callout),
  );
  const occupied = activeTargets.flatMap((index) => reviewed[index] ?? []);
  return callouts.map((callout, marker) => {
    const index = activeTargets[marker]!;
    const target = targets[index]!;
    const text = callout.label[locale].trim();
    const maxLabelWidth = Math.min(
      width - margin * 2,
      Math.max(200, width * 0.48),
    );
    const textWidth = Math.max(
      fontSize,
      maxLabelWidth - padding * 3 - badgeSize,
    );
    const lines = wrapLabel(text, textWidth, fontSize);
    const labelWidth = Math.min(
      maxLabelWidth,
      Math.max(
        ...lines.map((line) =>
          [...line].reduce(
            (sum, character) => sum + characterWidth(character, fontSize),
            0,
          ),
        ),
      ) +
        padding * 3 +
        badgeSize,
    );
    const labelHeight =
      Math.max(badgeSize, lineHeight * lines.length) + padding * 2;
    if (showLabel && labelHeight > height - margin * 2)
      throw new Error("Screenshot label is too long for the full image");
    const proposedX = callout.labelPosition
      ? callout.labelPosition.x * width
      : target.x;
    const above =
      callout.placement !== "below" && target.y >= labelHeight + margin * 2;
    const proposedY = callout.labelPosition
      ? callout.labelPosition.y * height
      : above
        ? target.y - labelHeight - margin
        : target.y + target.height + margin;
    const label = {
      x: Math.max(margin, Math.min(proposedX, width - labelWidth - margin)),
      y: Math.max(margin, Math.min(proposedY, height - labelHeight - margin)),
      width: labelWidth,
      height: labelHeight,
    };
    if (
      showLabel &&
      reviewed[index] &&
      distanceToTarget(reviewed[index], label) < radius + badgeClearance
    )
      throw new Error(
        "Reviewed screenshot badge position must stay clear of its annotation label",
      );
    const obstacles = controlObstacles(target, targets);
    const targetBadge =
      reviewed[index] ??
      automaticBadge(
        target,
        label,
        radius,
        showLabel,
        obstacles,
        occupied,
        width,
        height,
      );
    if (!reviewed[index]) occupied.push(targetBadge);
    const from = {
      x: Math.max(label.x, Math.min(targetBadge.x, label.x + label.width)),
      y: Math.max(label.y, Math.min(targetBadge.y, label.y + label.height)),
    };
    const leader =
      showLabel &&
      Math.hypot(from.x - targetBadge.x, from.y - targetBadge.y) > radius + 4 &&
      !obstacles.some((other) =>
        crossesTarget(from, targetBadge, {
          x: other.x - 3,
          y: other.y - 3,
          width: other.width + 6,
          height: other.height + 6,
        }),
      )
        ? { from, to: { x: targetBadge.x, y: targetBadge.y } }
        : undefined;
    return {
      number: marker + 1,
      text,
      lines,
      target,
      fontSize,
      lineHeight,
      padding,
      badgeSize,
      label,
      showLabel,
      targetBadge,
      leader,
    };
  });
}

export const annotationLabels = {
  en: {
    annotated: "Open annotated full screenshot",
    original: "Open original full screenshot",
    back: "Back to this guide step",
    pan: "This view keeps the original screenshot dimensions. Scroll horizontally or vertically to inspect every control.",
    source: "Capture source",
    details: "Capture details",
    open: "Open full screenshot",
    marker: "Callout",
  },
  zh: {
    annotated: "打开完整标注截图",
    original: "打开原始完整截图",
    back: "返回本指南步骤",
    pan: "此视图保留原始截图尺寸，可横向或纵向滚动查看每个控件。",
    source: "截图来源",
    details: "截图详情",
    open: "打开完整截图",
    marker: "标注",
  },
} as const;
