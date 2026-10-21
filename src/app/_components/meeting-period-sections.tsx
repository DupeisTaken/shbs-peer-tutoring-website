"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { DisclosureSection } from "./ui/disclosure-section";
import { Button } from "./ui/button";
import type { RouterOutputs } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";
import { InlineNotice } from "./ui/patterns";

type Catalog = RouterOutputs["tutor"]["meetingPeriods"];
const PeriodWork = createContext<{
  register: (id: string, busy: boolean) => void;
  previousGrouping: boolean;
} | null>(null);

/** Register only this owner's write/synchronization, never an aggregate busy value. */
export function useMeetingPeriodBusy(busy: boolean) {
  const work = useContext(PeriodWork);
  const register = work?.register;
  const id = useId();
  useLayoutEffect(() => {
    register?.(id, busy);
    return () => register?.(id, false);
  }, [register, id, busy]);
  return work?.previousGrouping ?? false;
}

/** Keep one keyed owner per recorded period, even when it moves from current
 * work into history. Hiding a group never discards an opened attendance draft. */
export function MeetingPeriodSections({
  catalog: latestCatalog,
  renderPeriod,
  onReload = () => window.location.reload(),
}: {
  catalog: Catalog;
  renderPeriod: (
    period: string,
    history: boolean,
    outsideCurrent?: string | null,
  ) => ReactNode;
  /** Host-owned navigation; normal callers reload the authoritative page. */
  onReload?: () => void;
}) {
  const t = useTranslations("meetingPeriods");
  const id = useId();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [closedCurrent, setClosedCurrent] = useState<string | null>(null);
  const { confirm, dialog } = useDialog();
  const [retainedCatalog, setRetainedCatalog] = useState(latestCatalog);
  const previousGrouping = retainedCatalog.quarters !== latestCatalog.quarters;
  // Preserve the complete controller graph across regrouping, including pending
  // writes and accepted-save recovery. Same-mode period rollovers still reconcile.
  if (!previousGrouping && retainedCatalog !== latestCatalog)
    setRetainedCatalog(latestCatalog);
  const catalog = previousGrouping ? retainedCatalog : latestCatalog;
  const busyOwners = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const register = useCallback((owner: string, pending: boolean) => {
    if (pending) busyOwners.current.add(owner);
    else busyOwners.current.delete(owner);
    setBusy(busyOwners.current.size > 0);
  }, []);
  const confirming = useRef(false);
  const latestPreviousGrouping = useRef(previousGrouping);
  useLayoutEffect(() => {
    latestPreviousGrouping.current = previousGrouping;
  }, [previousGrouping]);
  const reload = async () => {
    if (busyOwners.current.size || confirming.current) return;
    confirming.current = true;
    try {
      const accepted = await confirm({
        title: t("reloadTitle"),
        message: t("reloadWarning"),
        confirmLabel: t("reload"),
        cancelLabel: t("keepEditing"),
        danger: true,
      });
      // A write may have started while confirmation was open, or the applied
      // mode may have switched back. Neither case may discard an active owner.
      if (
        accepted &&
        !busyOwners.current.size &&
        latestPreviousGrouping.current
      )
        onReload();
    } finally {
      confirming.current = false;
    }
  };
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
              ? `${t(previousGrouping ? "previous" : "current")} · ${group.label}`
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
        <h2 className="section-title">
          {t(previousGrouping ? "previous" : "current")}
        </h2>
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
            {renderPeriod(
              "upcomingOutside",
              false,
              catalog.current?.key ?? null,
            )}
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
  return (
    <PeriodWork.Provider value={{ register, previousGrouping }}>
      <div className="min-w-0 space-y-5">
        {dialog}
        {previousGrouping && (
          <InlineNotice
            tone="warning"
            announcement="status"
            action={
              <Button disabled={busy} onClick={() => void reload()}>
                {t("reload")}
              </Button>
            }
          >
            <p>{t("groupingChanged")}</p>
            {busy && <p>{t("reloadBusy")}</p>}
          </InlineNotice>
        )}
        {sections}
      </div>
    </PeriodWork.Provider>
  );
}
