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
 *   `[(PT Logo) Title ⌄]   ...   [Account Text ⌄]  |  [Bell] [?] [Theme]  [Language]`
 *
 * Mobile (`<lg`, compact 2 rows with full 44px touch targets & centered brand lockup):
 *   Row 1: `[☰?]   [(PT Logo) Title ⌄]   [   ]` (symmetric 44px tracks keep the brand centered)
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
  /** Optional extra desktop-only identity node beside `account` (standard workspaces render text inside `UserAvatar`). */
  identity?: ReactNode;
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
        className={`flex min-w-0 flex-col gap-1.5 px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:gap-0 lg:px-6 lg:py-2.5 ${containerClassName}`}
      >
        {/* Row 1 on mobile: centered (PT Logo) Title v switcher, balanced against the
            44px drawer trigger when management navigation is present; flush-left on desktop. */}
        <div
          className={
            navigation
              ? "grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1.5 lg:contents"
              : "flex min-w-0 items-center justify-center lg:contents"
          }
        >
          {navigation ? (
            <div className="shrink-0 justify-self-start lg:hidden">
              {navigation}
            </div>
          ) : null}
          <div className="flex min-w-0 justify-center lg:contents">
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
          {navigation ? <div aria-hidden="true" className="lg:hidden" /> : null}
        </div>

        {/* Mobile row divider */}
        <div
          aria-hidden="true"
          className="h-px bg-slate-100 lg:hidden"
        />

        {/* Desktop flexible spacer */}
        <div aria-hidden="true" className="hidden lg:block lg:flex-1" />

        {/* Right controls: desktop DOM & visual order puts text-only Account left of | Bell ? Theme Language
            with symmetric 14px visual clearance around the divider and uniform 8px spacing across utilities;
            mobile flex order retains legacy Row 2: Bell ? Theme (left) ... Language Avatar (right). */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:contents">
          <div className="order-3 flex shrink-0 items-center gap-2 lg:order-none">
            {identity ? (
              <div className="hidden shrink-0 lg:block">{identity}</div>
            ) : null}
            <div className="shrink-0">{account}</div>
          </div>

          <span
            aria-hidden="true"
            className="hidden h-5 w-px shrink-0 bg-slate-200 lg:mr-3.5 lg:ml-1.5 lg:block"
          />

          <div className="order-1 flex shrink-0 items-center gap-1 lg:order-none lg:gap-2">
            <div className="shrink-0">
              <NotificationBell />
            </div>
            <div className="shrink-0 empty:hidden">
              <HelpLink />
            </div>
            <div className="shrink-0">
              <ThemeSwitcher compactAtDesktop />
            </div>
          </div>

          <div className="order-2 ml-auto shrink-0 lg:order-none lg:ml-2">
            <LanguageSwitcher compactAtDesktop />
          </div>
        </div>
      </div>
    </WorkspaceHeaderFrame>
  );
}
