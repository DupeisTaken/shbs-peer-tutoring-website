"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DisclosureSection } from "./ui/disclosure-section";
import { Button } from "./ui/button";
import type { RouterOutputs } from "~/trpc/react";

/** Keep one keyed owner per recorded period, even when it moves from current
 * work into history. Hiding a group never discards an opened attendance draft. */
export function MeetingPeriodSections({
  catalog,
  renderPeriod,
}: {
  catalog: RouterOutputs["tutor"]["meetingPeriods"];
  renderPeriod: (period: string, history: boolean) => ReactNode;
}) {
  const t = useTranslations("meetingPeriods");
  const id = useId();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [closedCurrent, setClosedCurrent] = useState<string | null>(null);
  const groupElement = (group: {
    key: string;
    label: string | null;
    count: number;
  }) => {
    const current = group.key === catalog.current?.key;
    return (
      <div
        key={group.key}
        id={`${id}-${group.key}`}
        hidden={!current && !historyOpen}
        className="min-w-0"
      >
        <DisclosureSection
          title={
            current
              ? `${t("current")} · ${group.label}`
              : t("group", {
                  period: group.label ?? t("unassigned"),
                  count: group.count,
                })
          }
          lifetime="retained"
          open={
            current ? closedCurrent !== group.key : openGroups.has(group.key)
          }
          onOpenChange={(open) => {
            if (current) setClosedCurrent(open ? null : group.key);
            else
              setOpenGroups((previous) => {
                const next = new Set(previous);
                if (open) next.add(group.key);
                else next.delete(group.key);
                return next;
              });
          }}
        >
          {renderPeriod(group.key, !current)}
        </DisclosureSection>
      </div>
    );
  };
  // One flat keyed sibling list preserves ownership when a current group becomes
  // historical. DOM order matches visual/keyboard order; no CSS reordering.
  const sections = [
    catalog.current ? (
      groupElement({ ...catalog.current, count: 0 })
    ) : (
      <section key="unconfigured" className="space-y-2">
        <h2 className="section-title">{t("current")}</h2>
        <p className="muted">{t("unconfigured")}</p>
      </section>
    ),
    ...(catalog.outsideUpcoming > 0
      ? [
          <section
            key="outside"
            className="min-w-0 space-y-3"
            aria-label={t("outside")}
          >
            <h2 className="section-title">{t("outside")}</h2>
            <p className="muted">{t("outsideHelp")}</p>
            {renderPeriod("upcomingOutside", false)}
          </section>,
        ]
      : []),
    <div key="history-toggle">
      <Button
        aria-expanded={historyOpen}
        aria-controls={[
          id,
          ...catalog.history.map((group) => `${id}-${group.key}`),
        ].join(" ")}
        onClick={() => setHistoryOpen((value) => !value)}
      >
        {t("history")}
      </Button>
      <p id={id} hidden={!historyOpen} className="muted mt-2">
        {catalog.history.length === 0 ? t("noHistory") : t("historyHelp")}
      </p>
    </div>,
    ...catalog.history.map(groupElement),
  ];
  return <div className="min-w-0 space-y-5">{sections}</div>;
}
