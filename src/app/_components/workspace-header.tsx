import type { ReactNode } from "react";

import type { WorkspaceSwitcherItem } from "~/lib/workspace-navigation";
import { HelpLink } from "./help-link";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { ThemeSwitcher } from "./theme-switcher";
import { WorkspaceHeaderFrame } from "./workspace-header-frame";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * One balanced, top-tier supervising header for all signed-in workspaces and signed-in Program Home.
 *
 * Desktop (`lg+`, single 56px row spanning `max-w-7xl` so Tier-1 chrome keeps calm outer side
 * margins on wide screens, aligns flush with Management, and cleanly supervises `max-w-6xl` and
 * `max-w-5xl` workspaces beneath it without jumping across routes):
 *   `[(PT Logo) Title ⌄]   ...   [Bell] [?] [Theme]  [Language]  |  [Account Text ⌄]`
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
  containerClassName = "mx-auto w-full max-w-7xl",
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
  /** Supervising Tier-1 desktop rail (defaults to `max-w-7xl` across all workspaces). */
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

        {/* Right controls: unified DOM & visual order across desktop and mobile puts
            Bell ? Theme (left on mobile) ... Language | Account (far right). Symmetric 14px
            visual clearance flanks the desktop divider against UserAvatar's lg:px-2 padding. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:contents">
          <div className="flex shrink-0 items-center gap-1 lg:gap-2">
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

          <div className="ml-auto shrink-0 lg:ml-2">
            <LanguageSwitcher compactAtDesktop />
          </div>

          <span
            aria-hidden="true"
            className="hidden h-5 w-px shrink-0 bg-slate-200 lg:mr-1.5 lg:ml-3.5 lg:block"
          />

          <div className="flex shrink-0 items-center gap-2 lg:-mr-2">
            {identity ? (
              <div className="hidden shrink-0 lg:block">{identity}</div>
            ) : null}
            <div className="shrink-0">{account}</div>
          </div>
        </div>
      </div>
    </WorkspaceHeaderFrame>
  );
}
