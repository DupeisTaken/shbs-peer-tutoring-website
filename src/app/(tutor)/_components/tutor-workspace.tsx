"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

const panels = ["schedule", "pairings", "preferences", "history"] as const;
type Panel = (typeof panels)[number];
export function tutorWorkspacePanel(hash: string): Panel {
  if (hash === "#tutor-pairings") return "pairings";
  if (hash === "#tutor-preferences" || hash === "#qualification-requests")
    return "preferences";
  if (hash === "#tutor-history") return "history";
  return "schedule";
}
const targets: Record<Panel, string> = {
  schedule: "sessions",
  pairings: "tutor-pairings",
  preferences: "tutor-preferences",
  history: "tutor-history",
};

/** Both legacy routes render this owner. Panels mount on first access and stay
 * mounted while hidden, so switching context never discards a feature's draft. */
export function TutorWorkspace({
  schedule,
  pairings,
  preferences,
  history,
  attention,
}: Record<Panel, ReactNode> & { attention?: ReactNode }) {
  const t = useTranslations("tutor.workspace");
  const [selected, setSelected] = useState<Panel>("schedule");
  const [visited, setVisited] = useState<Panel[]>(["schedule"]);
  if (!visited.includes(selected)) setVisited([...visited, selected]);
  useEffect(() => {
    let frame: number | undefined;
    const arrive = () => {
      // A native dialog owns focus until deliberately dismissed.
      if (document.querySelector("dialog[open]")) return;
      const hash = window.location.hash;
      setSelected(tutorWorkspacePanel(hash));
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
  }, []);
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
          anchor.hasAttribute("download")
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
            : url.hash;
        window.history.pushState(null, "", hash);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
    >
      {attention}
      <SectionTabs
        label={t("label")}
        items={panels.map((value) => ({ value, label: t(value) }))}
        value={selected}
        onChange={(value) => {
          setSelected(value);
          // Keep native Back/Forward and existing notification fragments meaningful.
          window.history.pushState(null, "", `#${targets[value]}`);
        }}
      >
        {panels.map((panel) => (
          <div key={panel} hidden={panel !== selected}>
            {visited.includes(panel) || selected === panel
              ? { schedule, pairings, preferences, history }[panel]
              : null}
          </div>
        ))}
      </SectionTabs>
    </div>
  );
}
