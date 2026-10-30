"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

const legacyTargets = new Set(["sessions", "attendance", "tutor-meetings"]);

/** A fragment arrival must not unmount a dashboard editor or interrupt a write.
 * Keep old bookmarks usable through an explicit continuation into Schedule. */
export function DashboardScheduleLinks({
  interviewsEnabled,
}: {
  interviewsEnabled: boolean;
}) {
  const t = useTranslations("tutor.schedulePage");
  const [legacyTarget, setLegacyTarget] = useState<string | null>(null);
  const revealFrame = useRef<number | null>(null);
  useEffect(() => {
    const reveal = () => {
      if (revealFrame.current !== null)
        cancelAnimationFrame(revealFrame.current);
      const target = window.location.hash.slice(1);
      const legacy = legacyTargets.has(target) ? target : null;
      setLegacyTarget(legacy);
      if (legacy)
        revealFrame.current = requestAnimationFrame(() => {
          revealFrame.current = null;
          // A later fragment arrival must also leave an open dialog's focus intact.
          if (!document.querySelector("dialog[open]"))
            focusVisibleContext(document.getElementById(legacy));
        });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
      if (revealFrame.current !== null)
        cancelAnimationFrame(revealFrame.current);
    };
  }, []);
  return (
    <section className="card space-y-2 p-4 sm:p-5" aria-label={t("title")}>
      {/* Stable legacy targets retain browser history and focus without navigation side effects. */}
      {[...legacyTargets].map((id) => (
        <div
          key={id}
          id={id}
          tabIndex={-1}
          aria-label={t("title")}
          className="scroll-mt-6"
        />
      ))}
      {legacyTarget && (
        <p className="text-sm" role="status">
          {t("legacyHelp")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link
          className="btn-primary btn-sm"
          href={legacyTarget ? `/schedule#${legacyTarget}` : "/schedule"}
        >
          {t("openSchedule")}
        </Link>
        {interviewsEnabled && (
          <Link
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href="/schedule#tutor-interviews"
          >
            {t("interviews")}
          </Link>
        )}
      </div>
    </section>
  );
}
