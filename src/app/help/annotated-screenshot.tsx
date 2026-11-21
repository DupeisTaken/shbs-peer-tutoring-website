import type { HelpScreenshot } from "~/lib/help/screenshots";
import type { HelpLocale, HelpStep } from "~/lib/help/types";
import { annotationColors, layoutHelpCallouts } from "./screenshot-annotations";

export function AnnotatedScreenshot({
  step,
  screenshot,
  locale,
  src,
  alt,
  href,
  linkLabel,
}: {
  step: HelpStep;
  screenshot: HelpScreenshot;
  locale: HelpLocale;
  src: string;
  alt: string;
  href?: string;
  linkLabel?: string;
}) {
  const annotations = layoutHelpCallouts(step, screenshot, locale);
  const hasInlineLabels = annotations.every(
    (annotation) => annotation.showLabel,
  );
  const picture = (
    <div
      className="relative mx-auto"
      style={{ maxWidth: screenshot.viewport.width }}
    >
      {/* Protected native image requests avoid creating a publicly cached copy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={screenshot.viewport.width}
        height={screenshot.viewport.height}
        loading="lazy"
        className="block h-auto w-full"
      />
      {annotations.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
          viewBox={`0 0 ${screenshot.viewport.width} ${screenshot.viewport.height}`}
        >
          <g
            data-callout-leaders="true"
            className={href ? "max-sm:hidden" : undefined}
          >
            {annotations.map(
              (annotation) =>
                annotation.leader && (
                  <g key={annotation.number}>
                    <line
                      x1={annotation.leader.from.x}
                      y1={annotation.leader.from.y}
                      x2={annotation.leader.to.x}
                      y2={annotation.leader.to.y}
                      stroke={annotationColors.backing}
                      strokeWidth="6"
                    />
                    <line
                      data-callout-leader={annotation.number}
                      x1={annotation.leader.from.x}
                      y1={annotation.leader.from.y}
                      x2={annotation.leader.to.x}
                      y2={annotation.leader.to.y}
                      stroke={annotationColors.outline}
                      strokeWidth="2"
                    />
                  </g>
                ),
            )}
          </g>
          {annotations.map((annotation) => (
            <g key={annotation.number}>
              <rect
                {...annotation.target}
                rx="4"
                fill="none"
                stroke={annotationColors.backing}
                strokeWidth="5"
              />
              <rect
                {...annotation.target}
                rx="4"
                fill="none"
                stroke={annotationColors.outline}
                strokeWidth="3"
              />
              {annotation.showLabel && (
                <g
                  data-callout-label={annotation.number}
                  className={href ? "max-sm:hidden" : undefined}
                >
                  <rect
                    {...annotation.label}
                    rx="6"
                    fill={annotationColors.ink}
                    stroke={annotationColors.backing}
                    strokeWidth="2"
                  />
                  <circle
                    cx={
                      annotation.label.x +
                      annotation.padding +
                      annotation.badgeSize / 2
                    }
                    cy={annotation.label.y + annotation.label.height / 2}
                    r={annotation.badgeSize / 2}
                    fill={annotationColors.backing}
                  />
                  <text
                    x={
                      annotation.label.x +
                      annotation.padding +
                      annotation.badgeSize / 2
                    }
                    y={annotation.label.y + annotation.label.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily="Arial, sans-serif"
                    fontSize={annotation.fontSize}
                    fontWeight="700"
                    fill={annotationColors.ink}
                  >
                    {annotation.number}
                  </text>
                  <text
                    fontFamily="Arial, sans-serif"
                    fontSize={annotation.fontSize}
                    fill={annotationColors.text}
                  >
                    {annotation.lines.map((line, index) => (
                      <tspan
                        key={index}
                        x={
                          annotation.label.x +
                          annotation.padding * 2 +
                          annotation.badgeSize
                        }
                        y={
                          annotation.label.y +
                          annotation.padding +
                          annotation.fontSize +
                          index * annotation.lineHeight
                        }
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )}
            </g>
          ))}
          <g data-callout-targets="true">
            {annotations.map((annotation) => (
              <g key={annotation.number}>
                <circle
                  data-callout-target={annotation.number}
                  cx={annotation.targetBadge.x}
                  cy={annotation.targetBadge.y}
                  r={annotation.targetBadge.radius}
                  fill={annotationColors.ink}
                  stroke={annotationColors.backing}
                  strokeWidth="2"
                />
                <text
                  data-callout-target-number={annotation.number}
                  x={annotation.targetBadge.x}
                  y={annotation.targetBadge.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="Arial, sans-serif"
                  fontSize={annotation.fontSize * 0.85}
                  fontWeight="700"
                  fill={annotationColors.text}
                >
                  {annotation.number}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
  return (
    <div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={linkLabel ?? alt}
        >
          {picture}
        </a>
      ) : (
        picture
      )}
      {annotations.length > 0 && (
        <ol
          aria-label={locale === "zh" ? "截图标注" : "Screenshot callouts"}
          className={`list-decimal space-y-1 border-t border-slate-200 py-3 pr-4 pl-9 text-sm leading-6 text-slate-800 ${hasInlineLabels ? (href ? "sm:sr-only" : "sr-only") : ""}`}
        >
          {annotations.map((annotation) => (
            <li key={annotation.number} value={annotation.number}>
              {annotation.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
