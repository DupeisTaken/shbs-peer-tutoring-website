"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { focusVisibleContext } from "./focus-visible-context";

/** Presentational step landmark. The feature owns validation and proof lifetime;
 * focus changes only for deliberate step transitions, never background queries. */
export function RegistrationProgress({
  steps,
  current,
  title,
  busy,
}: {
  steps: string[];
  current: number;
  title: string;
  busy: boolean;
}) {
  const t = useTranslations("registrationFlow");
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(current);
  useEffect(() => {
    if (previous.current !== current) focusVisibleContext(heading.current);
    previous.current = current;
  }, [current]);
  return (
    <div className="space-y-3">
      <ol
        aria-label={t("progressTitle")}
        className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500"
      >
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            className={
              index === current ? "text-accent-800 font-semibold" : undefined
            }
          >
            {index + 1}. {step}
          </li>
        ))}
      </ol>
      <p className="muted text-sm">
        {t("stepCount", { current: current + 1, total: steps.length })}
      </p>
      <h2
        ref={heading}
        tabIndex={-1}
        className="section-title outline-offset-4"
      >
        {title}
      </h2>
      {busy && (
        <p role="status" className="muted">
          {t("working")}
        </p>
      )}
    </div>
  );
}
