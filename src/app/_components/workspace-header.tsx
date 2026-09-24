import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { ThemeSwitcher } from "./theme-switcher";
import { WorkspaceLinks, type WorkspaceLink } from "./workspace-links";

/** One responsive header for all workspaces. Mobile rows keep language with the
 * brand, menu opposite global controls, and workspace switches together below.
 * CSS rearranges the same controls on desktop; no duplicate interactive menus.
 */
export function WorkspaceHeader({
  href,
  title,
  items,
  identity,
  account,
  navigation,
}: {
  href: string;
  title: string;
  items: WorkspaceLink[];
  identity: ReactNode;
  account: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 px-4 py-4 lg:flex lg:gap-2 lg:px-6 lg:py-3">
        <Link
          href={href}
          title={title}
          className="col-span-2 col-start-1 row-start-1 flex min-h-11 min-w-0 items-center truncate text-xl font-bold text-slate-900 lg:order-1 lg:mr-auto lg:text-lg"
        >
          {title}
        </Link>
        <div className="col-start-3 row-start-1 justify-self-end lg:order-6">
          <LanguageSwitcher compactAtDesktop />
        </div>
        {navigation ? (
          <div className="col-start-1 row-start-2 justify-self-start lg:hidden">
            {navigation}
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="col-span-3 col-start-1 row-start-3 min-w-0 border-t border-slate-100 pt-3 lg:order-2 lg:border-0 lg:pt-0">
            <WorkspaceLinks items={items} />
          </div>
        ) : null}
        <div className="hidden shrink-0 lg:order-3 lg:block">{identity}</div>
        <div className="col-span-2 col-start-2 row-start-2 flex items-center justify-end gap-2 lg:contents">
          <div className="shrink-0 lg:order-4">
            <ThemeSwitcher compactAtDesktop />
          </div>
          <div className="shrink-0 lg:order-5">
            <NotificationBell />
          </div>
          <div className="shrink-0 lg:order-7">{account}</div>
        </div>
      </div>
    </header>
  );
}
