"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";

/** An optional reading pause for a local review, separate from server tickets and
 * membership cooldowns. Each dialog opening mounts its own monotonic deadline. */
export function useReviewDelay(delayMs = 0) {
  const descriptionId = useId();
  const duration = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
  const [deadline] = useState(() => performance.now() + duration);
  const [remaining, setRemaining] = useState(() => Math.ceil(duration / 1_000));
  useEffect(() => {
    if (!duration) return;
    let timer: ReturnType<typeof setTimeout>;
    const sample = () => {
      clearTimeout(timer);
      const left = Math.max(0, deadline - performance.now());
      setRemaining(Math.ceil(left / 1_000));
      if (left > 0)
        timer = setTimeout(sample, Math.max(1, left % 1_000 || 1_000));
    };
    sample();
    window.addEventListener("focus", sample);
    document.addEventListener("visibilitychange", sample);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", sample);
      document.removeEventListener("visibilitychange", sample);
    };
  }, [deadline, duration]);
  return {
    remaining,
    descriptionId,
    // Admission reads elapsed time again instead of trusting a delayed callback.
    ready: () => performance.now() >= deadline,
  };
}

export function ReviewCountdown({
  remaining,
  id,
}: {
  remaining: number;
  id: string;
}) {
  const t = useTranslations("workflow");
  return (
    <p
      id={id}
      role="status"
      className="w-full text-sm font-medium text-red-800"
    >
      {t("wait", { seconds: remaining })}
    </p>
  );
}
