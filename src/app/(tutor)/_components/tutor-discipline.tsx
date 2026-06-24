"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DisciplineSlots } from "~/app/_components/discipline-slots";
import { NativeDisclosureIcon } from "~/app/_components/icons";

/**
 * Punishment history for the tutor's own tutees: each tutee's discipline meter plus a card
 * timeline (colour · valid/pending · date). **Card reasons are never shown to tutors** — only the
 * standing and the outcome of each card. Self-hides when the tutor has no tutees with cards.
 */
export function TutorDiscipline() {
  const t = useTranslations();
  const discipline = api.tutor.myTuteeDiscipline.useQuery();

  const rows = (discipline.data ?? []).filter((d) => d.cards.length > 0);
  if (rows.length === 0) return null;

  const dot = (color: "YELLOW" | "RED") => (color === "RED" ? "🟥" : "🟨");

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("tutor.discipline.title")}</h2>
      <p className="muted mt-1 mb-3 text-sm">{t("tutor.discipline.help")}</p>

      <div className="divide-y divide-slate-100">
        {rows.map((d) => (
          <details key={d.tuteeId} className="group py-2">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 [&::-webkit-details-marker]:hidden">
              <NativeDisclosureIcon />
              <span className="w-40 truncate font-medium text-slate-800 group-open:text-accent-700">
                {d.englishName}
              </span>
              <DisciplineSlots validRed={d.validRed} validYellow={d.validYellow} size="sm" />
              {d.removalPending ? (
                <span className="badge-red">{t("tutor.discipline.removalBadge")}</span>
              ) : d.effectiveReds >= 1 ? (
                <span className="badge-amber">{t("tutor.discipline.onWarning")}</span>
              ) : (
                <span className="badge-slate">{t("tutor.discipline.ok")}</span>
              )}
              {d.pendingCount > 0 && (
                <span className="muted text-xs">
                  {t("tutor.discipline.pendingCount", { n: d.pendingCount })}
                </span>
              )}
            </summary>
            <ul className="mt-2 ml-1 space-y-1">
              {d.cards.map((c) => (
                <li key={c.id} className="text-xs text-slate-600">
                  {dot(c.color)}{" "}
                  <span className="text-slate-400">
                    {new Date(c.date).toLocaleDateString()} ·{" "}
                    {t(`tutor.discipline.cardStatus.${c.reviewStatus}`)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
