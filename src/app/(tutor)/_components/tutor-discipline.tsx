"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { api } from "~/trpc/react";
import { DisciplineSlots } from "~/app/_components/discipline-slots";
import { NativeDisclosureIcon } from "~/app/_components/icons";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

/**
 * Punishment history for the tutor's own tutees: each tutee's discipline meter plus a card
 * timeline (colour · valid/pending · date). **Card reasons are never shown to tutors** — only the
 * standing and the outcome of each card. Self-hides when the tutor has no tutees with cards.
 */
export function TutorDiscipline() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const recovery = useTranslations("participantRecovery");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const discipline = api.tutor.myTuteeDiscipline.useQuery(undefined, {
    enabled: !denied,
  });
  const authorizationDenied =
    discipline.error?.data?.code === "FORBIDDEN" ||
    discipline.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (!authorizationDenied) return;
    setDenied(true);
    queryClient.removeQueries({
      queryKey: getQueryKey(api.tutor.myTuteeDiscipline, undefined, "query"),
    });
  }, [authorizationDenied, queryClient]);
  useEffect(() => {
    if (discipline.isSuccess && !discipline.isFetching) setDenied(false);
  }, [discipline.isSuccess, discipline.isFetching]);
  const retry = () => {
    void discipline.refetch();
  };
  if (denied || authorizationDenied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button
            size="compact"
            disabled={discipline.isFetching}
            onClick={retry}
          >
            {recovery("retry")}
          </Button>
        }
      >
        {recovery("accessDeniedHelp")}
      </StatePanel>
    );

  const rows = (discipline.data ?? []).filter((d) => d.cards.length > 0);
  // Only a completed, successful empty read may hide this optional section.
  if (discipline.isSuccess && rows.length === 0) return null;

  const dot = (color: "YELLOW" | "RED") => (color === "RED" ? "🟥" : "🟨");

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("tutor.discipline.title")}</h2>
      <p className="muted mt-1 mb-3 text-sm">{t("tutor.discipline.help")}</p>
      <QueryFeedback
        hasData={!!discipline.data}
        loading={!discipline.data && !discipline.error}
        error={!!discipline.error}
        retrying={discipline.isFetching}
        loadingTitle={recovery("loading")}
        errorTitle={recovery(discipline.data ? "refreshFailed" : "loadFailed")}
        retryLabel={recovery("retry")}
        onRetry={retry}
      />

      <div className="divide-y divide-slate-100">
        {rows.map((d) => (
          <details key={d.tuteeId} className="group py-2">
            {/* Mounted read details preserve the expanded timeline across background recovery. */}
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 lg:min-h-8 [&::-webkit-details-marker]:hidden">
              <NativeDisclosureIcon />
              <span className="group-open:text-accent-700 min-w-0 basis-40 font-medium [overflow-wrap:anywhere] text-slate-800">
                {d.englishName}
              </span>
              <DisciplineSlots
                validRed={d.validRed}
                validYellow={d.validYellow}
                size="sm"
              />
              {d.removalPending ? (
                <span className="badge-red">
                  {t("tutor.discipline.removalBadge")}
                </span>
              ) : d.effectiveReds >= 1 ? (
                <span className="badge-amber">
                  {t("tutor.discipline.onWarning")}
                </span>
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
                    {programFormat.dateTime(new Date(c.date), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}{" "}
                    · {t(`tutor.discipline.cardStatus.${c.reviewStatus}`)}
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
