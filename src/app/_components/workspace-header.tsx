import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { ThemeSwitcher } from "./theme-switcher";
import { WorkspaceLinks, type WorkspaceLink } from "./workspace-links";
import { WorkspaceHeaderFrame } from "./workspace-header-frame";

/** One responsive header for all workspaces. DOM order follows desktop left-to-right
 * visual/Tab reading order; mobile grid placement keeps language beside the brand,
 * menu opposite global controls, and workspace switches together below with 44px targets.
 */
export function WorkspaceHeader({
  href,
  title,
  items,
  identity,
  account,
  navigation,
  skipLabel,
  skipToId = "main-content",
  containerClassName = "mx-auto max-w-7xl",
}: {
  href: string;
  title: string;
  items: WorkspaceLink[];
  identity: ReactNode;
  account: ReactNode;
  navigation?: ReactNode;
  skipLabel?: string;
  skipToId?: string;
  /** Align desktop header edges with the host workspace frame (7xl admin, 6xl participant, etc.). */
  containerClassName?: string;
}) {
  return (
    <WorkspaceHeaderFrame>
      {skipLabel ? (
        <a href={`#${skipToId}`} className="skip-link">
          {skipLabel}
        </a>
      ) : null}
      <div
        className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-4 py-2.5 lg:flex lg:gap-2 lg:px-6 lg:py-3 ${containerClassName}`}
      >
        <Link
          href={href}
          title={title}
          className="col-span-2 col-start-1 row-start-1 flex min-h-11 min-w-0 items-center gap-2.5 text-xl font-bold break-words text-slate-900 lg:mr-auto lg:min-h-8 lg:text-lg"
        >
          <BrandMark />
          <span className="min-w-0">{title}</span>
        </Link>
        {navigation ? (
          <div className="col-start-1 row-start-2 justify-self-start lg:hidden">
            {navigation}
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="col-span-3 col-start-1 row-start-3 min-w-0 border-t border-slate-100 pt-2 lg:border-0 lg:pt-0">
            <WorkspaceLinks items={items} />
          </div>
        ) : null}
        <div className="hidden shrink-0 lg:block">{identity}</div>
        {/* Enlarged touch targets may outgrow these two mobile grid columns.
            Wrap within their area instead of overflowing left onto navigation;
            desktop still places the same controls directly in its flex row. */}
        <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-2 lg:contents">
          <div className="shrink-0">
            <ThemeSwitcher compactAtDesktop />
          </div>
          <div className="shrink-0">
            <NotificationBell />
          </div>
          <div className="shrink-0 lg:order-2">{account}</div>
        </div>
        <div className="col-start-3 row-start-1 justify-self-end lg:order-1">
          <LanguageSwitcher compactAtDesktop />
        </div>
      </div>
    </WorkspaceHeaderFrame>
  );
}
