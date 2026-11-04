"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/app/_components/ui/button";
import {
  AgendaBadge,
  AgendaEventCard,
} from "~/app/_components/agenda-event-card";

/** Synthetic presentation examples; actual schedules retain all action authority. */
export function AgendaEventRecipe() {
  const t = useTranslations("agendaEvents");
  const sessionText = useTranslations("sessionPlanning");
  const [recorded, setRecorded] = useState(false);
  return (
    <section
      id="agenda-event-recipe"
      className="card space-y-4 p-4 sm:p-5 lg:col-span-2"
    >
      <h2 className="section-title">
        {t("regular")} · {t("extra")} · {t("interview")} · {t("meeting")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <AgendaEventCard
          id="gallery-regular"
          kind="regular"
          title="Mathematics"
          time="Mon · 15:30–16:15"
          details={
            <>
              <p>Alex · Sam</p>
              <p>A101</p>
            </>
          }
          badges={
            <AgendaBadge tone={recorded ? "success" : "warning"}>
              {t(recorded ? "completed" : "needsAction")}
            </AgendaBadge>
          }
          actions={
            !recorded && (
              <Button size="compact" onClick={() => setRecorded(true)}>
                {sessionText("record")}
              </Button>
            )
          }
        >
          {!recorded && (
            <p className="text-sm text-yellow-900">{t("attendanceNeeded")}</p>
          )}
        </AgendaEventCard>
        <AgendaEventCard
          id="gallery-extra"
          kind="extra"
          title="Physics"
          time="Tue · 15:30–16:15"
          badges={<AgendaBadge>{t("upcoming")}</AgendaBadge>}
        />
        <AgendaEventCard
          id="gallery-interview"
          kind="interview"
          title="Alex · Mathematics"
          time="Wed · 16:00"
          badges={
            <>
              <AgendaBadge tone="success">{t("voteRecorded")}</AgendaBadge>
              <AgendaBadge>{t("awaitingDecision")}</AgendaBadge>
            </>
          }
        />
        <AgendaEventCard
          id="gallery-meeting"
          kind="meeting"
          title="Team meeting"
          time="Thu · 16:00"
          badges={
            <>
              <AgendaBadge tone="excused">{t("excused")}</AgendaBadge>
              <AgendaBadge tone="success">{t("completed")}</AgendaBadge>
            </>
          }
        />
      </div>
    </section>
  );
}
