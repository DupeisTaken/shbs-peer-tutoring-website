import type { ReactNode } from "react";

import type { WorkspaceSwitcherItem } from "~/lib/workspace-navigation";
import { HelpLink } from "./help-link";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { ThemeSwitcher } from "./theme-switcher";
import { WorkspaceHeaderFrame } from "./workspace-header-frame";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * One balanced, calm header for all signed-in workspaces and signed-in Program Home.
 *
 * Desktop (`lg+`, single 56px row):
 *   `[(PT Logo) Title ⌄]   ...   [Bell] [?] [Theme]  [Language]  |  [User & Portrait]`
 *
 * Mobile (`<lg`, compact 2 rows with full 44px touch targets & zero title truncation):
 *   Row 1: `[☰?] [(PT Logo) Title ⌄]`
 *   Row 2: `[Bell] [?] [Theme]   ...   [Language] [Avatar]`
 */
export function WorkspaceHeader({
  href,
  title,
  hideTitle = false,
  switcherItems = [],
  switcherLabels,
  identity,
  account,
  navigation,
  skipLabel,
  skipToId = "main-content",
  containerClassName = "mx-auto max-w-7xl",
}: {
  href: string;
  /** Short current-area title shown beside the PT logo (e.g. "Management", "Program Overview", "Tutor"). */
  title: string;
  /** Hide visible title text beside the logo (used on Program Home while keeping the switcher menu). */
  hideTitle?: boolean;
  /** Authorized other destinations for the `(Logo) Title ⌄` dropdown (current area already excluded). */
  switcherItems?: WorkspaceSwitcherItem[];
  switcherLabels?: {
    menuLabel: string;
    workspacesGroupLabel: string;
    generalGroupLabel: string;
  };
  identity: ReactNode;
  account: ReactNode;
  navigation?: ReactNode;
  skipLabel?: string;
  skipToId?: string;
  /** Align desktop header edges with the host workspace frame (7xl admin, 6xl participant, etc.). */
  containerClassName?: string;
}) {
  const labels = switcherLabels ?? {
    menuLabel: "Switch workspace",
    workspacesGroupLabel: "Workspaces",
    generalGroupLabel: "General",
  };

  return (
    <WorkspaceHeaderFrame>
      {skipLabel ? (
        <a href={`#${skipToId}`} className="skip-link">
          {skipLabel}
        </a>
      ) : null}
      <div
        className={`flex min-w-0 flex-col gap-1.5 px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:gap-1.5 lg:px-6 lg:py-2.5 ${containerClassName}`}
      >
        {/* Left: optional mobile drawer trigger + (PT Logo) Title v workspace switcher */}
        <div className="flex min-w-0 items-center gap-1.5 lg:contents">
          {navigation ? (
            <div className="shrink-0 lg:hidden">{navigation}</div>
          ) : null}
          <WorkspaceSwitcher
            href={href}
            title={title}
            hideTitle={hideTitle}
            items={switcherItems}
            menuLabel={labels.menuLabel}
            workspacesGroupLabel={labels.workspacesGroupLabel}
            generalGroupLabel={labels.generalGroupLabel}
          />
        </div>

        {/* Mobile row divider */}
        <div
          aria-hidden="true"
          className="h-px bg-slate-100 lg:hidden"
        />

        {/* Desktop flexible spacer */}
        <div aria-hidden="true" className="hidden lg:block lg:flex-1" />

        {/* Right utilities in exact order: Bell, Question Mark, Theme, Language | User & Portrait (far right) */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 lg:contents">
          <div className="flex shrink-0 items-center gap-0.5 lg:contents">
            <div className="shrink-0">
              <NotificationBell />
            </div>
            <div className="shrink-0">
              <HelpLink />
            </div>
            <div className="shrink-0">
              <ThemeSwitcher compactAtDesktop />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 lg:contents">
            <div className="shrink-0 lg:ml-1">
              <LanguageSwitcher compactAtDesktop />
            </div>

            <span
              aria-hidden="true"
              className="mx-1.5 hidden h-4 w-px shrink-0 bg-slate-200 lg:block"
            />

            <div className="flex shrink-0 items-center gap-1.5">
              <div className="hidden shrink-0 lg:block">{identity}</div>
              <div className="shrink-0">{account}</div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceHeaderFrame>
  );
}
