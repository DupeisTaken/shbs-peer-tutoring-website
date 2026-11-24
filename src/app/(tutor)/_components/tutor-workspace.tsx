"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

const basePanels = ["schedule", "pairings", "preferences", "history"] as const;
const allPanels = [
  "schedule",
  "pairings",
  "preferences",
  "history",
  "chair",
] as const;
type Panel = (typeof allPanels)[number];
export function tutorWorkspacePanel(
  hash: string,
  hasChair = false,
  pathname = "",
): Panel {
  if (hash === "#tutor-pairings") return "pairings";
  if (hash === "#tutor-preferences" || hash === "#qualification-requests")
    return "preferences";
  if (hash === "#tutor-history") return "history";
  if (
    hasChair &&
    (hash === "#chair-interviews" ||
      (hash === "#tutor-interviews" && pathname !== "/schedule"))
  )
    return "chair";
  return "schedule";
}
const targets: Record<Panel, string> = {
  schedule: "sessions",
  pairings: "tutor-pairings",
  preferences: "tutor-preferences",
  history: "tutor-history",
  chair: "chair-interviews",
};

/** Both legacy routes render this owner. Panels mount on first access and stay
 * mounted while hidden, so switching context never discards a feature's draft. */
export function TutorWorkspace({
  schedule,
  pairings,
  preferences,
  history,
  chair,
  attention,
}: Omit<Record<Panel, ReactNode>, "chair"> & {
  chair?: ReactNode;
  attention?: ReactNode;
}) {
  const t = useTranslations("tutor.workspace");
  const hasChair = chair !== undefined;
  const visiblePanels: readonly Panel[] = hasChair ? allPanels : basePanels;
  const [selected, setSelected] = useState<Panel>("schedule");
  const activePanel: Panel = visiblePanels.includes(selected)
    ? selected
    : "schedule";
  const [visited, setVisited] = useState<Panel[]>(["schedule"]);
  if (!visited.includes(activePanel)) setVisited([...visited, activePanel]);
  useEffect(() => {
    let frame: number | undefined;
    const arrive = () => {
      // A native dialog owns focus until deliberately dismissed.
      if (document.querySelector("dialog[open]")) return;
      const hash = window.location.hash;
      setSelected(tutorWorkspacePanel(hash, hasChair, window.location.pathname));
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          window.location.hash === hash &&
          !document.querySelector("dialog[open]")
        )
          focusVisibleContext(document.getElementById(hash.slice(1)));
      });
    };
    arrive();
    window.addEventListener("hashchange", arrive);
    window.addEventListener("popstate", arrive);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", arrive);
      window.removeEventListener("popstate", arrive);
    };
  }, [hasChair]);
  const panelContent: Record<Panel, ReactNode> = {
    schedule,
    pairings,
    preferences,
    history,
    chair,
  };
  return (
    <div
      className="space-y-4"
      onClickCapture={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.defaultPrevented
        )
          return;
        const anchor = (event.target as HTMLElement).closest("a[href]");
        if (
          !(anchor instanceof HTMLAnchorElement) ||
          anchor.target ||
          anchor.hasAttribute("download") ||
          anchor.closest("dialog[open]")
        )
          return;
        const url = new URL(anchor.href);
        if (
          url.origin !== window.location.origin ||
          !["/dashboard", "/schedule"].includes(url.pathname) ||
          !url.hash ||
          url.search
        )
          return;
        event.preventDefault();
        // Localize legacy cross-route links without unmounting the live workspace.
        const hash =
          url.pathname === "/schedule" && url.hash === "#tutor-interviews"
            ? "#tutor-appointments"
            : url.pathname === "/dashboard" && url.hash === "#tutor-interviews"
              ? hasChair
                ? "#chair-interviews"
                : "#tutor-appointments"
              : url.hash;
        window.history.pushState(null, "", hash);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
    >
      {attention}
      <SectionTabs
        label={t("label")}
        items={visiblePanels.map((value) => ({ value, label: t(value) }))}
        value={activePanel}
        onChange={(value) => {
          setSelected(value);
          // Keep native Back/Forward and existing notification fragments meaningful.
          window.history.pushState(null, "", `#${targets[value]}`);
        }}
      >
        {visiblePanels.map((panel) => (
          <div key={panel} hidden={panel !== activePanel}>
            {visited.includes(panel) || activePanel === panel
              ? panelContent[panel]
              : null}
          </div>
        ))}
      </SectionTabs>
    </div>
  );
}
