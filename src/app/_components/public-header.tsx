"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { useBranding } from "./branding-provider";
import { HelpLink } from "./help-link";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

/** The frame is also used by local gallery examples; production utilities keep
 * their existing preference behavior and one instance per page. */
export function PublicHeader({
  navigation,
  trailingAction,
  title,
  hideTitle = false,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
  showHelp = true,
}: {
  navigation?: ReactNode;
  /** Optional primary menu/action anchored to the far right (e.g. Sign In & Join on Program Home). */
  trailingAction?: ReactNode;
  /** Optional location title beside the PT logo (defaults to configured APP_TITLE). */
  title?: string;
  /** Hide visible title text beside the logo while keeping an accessible name. */
  hideTitle?: boolean;
  sticky?: boolean;
  skipLabel?: string;
  skipToId?: string;
  showHelp?: boolean;
}) {
  const { APP_TITLE } = useBranding();
  return (
    <PublicHeaderFrame
      title={title ?? APP_TITLE}
      hideTitle={hideTitle}
      navigation={navigation}
      trailingAction={trailingAction}
      sticky={sticky}
      skipLabel={skipLabel}
      skipToId={skipToId}
      help={showHelp ? <HelpLink /> : undefined}
      language={<LanguageSwitcher compactAtDesktop />}
      theme={<ThemeSwitcher compactAtDesktop />}
    />
  );
}

/** Balanced, tidy public header: official PT logo + bold brand-lockup title anchor the left,
 * optional subpage return link sits beside the title, and ?, Theme, Language, plus an optional
 * far-right action/menu stay grouped on the right. */
export function PublicHeaderFrame({
  navigation,
  trailingAction,
  title,
  hideTitle = false,
  help,
  language,
  theme,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
}: {
  title: string;
  hideTitle?: boolean;
  help?: ReactNode;
  language: ReactNode;
  theme: ReactNode;
  navigation?: ReactNode;
  trailingAction?: ReactNode;
  sticky?: boolean;
  skipLabel?: string;
  skipToId?: string;
}) {
  const unifiedTrailing = !navigation && !!trailingAction;

  return (
    <header
      data-sticky-header={sticky || undefined}
      className={`${sticky ? "sticky top-0 z-20" : ""} border-b border-slate-200/80 bg-white/95 backdrop-blur-xs`}
    >
      {skipLabel ? (
        <a href={`#${skipToId}`} className="skip-link">
          {skipLabel}
        </a>
      ) : null}

      {unifiedTrailing ? (
        <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-1.5 px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:gap-1.5 lg:py-2.5">
          <div className="flex min-w-0 items-center lg:contents">
            <Link
              href="/"
              title={title}
              aria-label={hideTitle ? title : undefined}
              className="focus-visible:ring-accent-500 flex min-h-11 min-w-0 items-center gap-2.5 rounded-md text-xl font-bold tracking-tight text-slate-900 transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:shrink-0 lg:text-lg"
            >
              <BrandMark className="h-8 w-8" />
              {!hideTitle ? (
                <span className="min-w-0 truncate">{title}</span>
              ) : null}
            </Link>
          </div>
          <div aria-hidden="true" className="h-px bg-slate-100 lg:hidden" />
          <div aria-hidden="true" className="hidden lg:block lg:flex-1" />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 lg:contents">
            <div className="flex shrink-0 items-center gap-0.5 lg:contents">
              {help ? <div className="shrink-0">{help}</div> : null}
              <div className="shrink-0">{theme}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 lg:contents">
              <div className="shrink-0 lg:ml-1">{language}</div>
              <span
                aria-hidden="true"
                className="mx-1.5 hidden h-4 w-px shrink-0 bg-slate-200 lg:block"
              />
              <div className="shrink-0">{trailingAction}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 px-4 py-2 lg:flex lg:gap-2 lg:py-2.5">
          <Link
            href="/"
            title={title}
            aria-label={hideTitle ? title : undefined}
            className="focus-visible:ring-accent-500 col-start-1 row-start-1 flex min-h-11 min-w-0 items-center gap-2.5 rounded-md text-xl font-bold tracking-tight text-slate-900 transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 lg:shrink-0 lg:text-lg"
          >
            <BrandMark className="h-8 w-8" />
            {!hideTitle ? (
              <span className="min-w-0 truncate">{title}</span>
            ) : null}
          </Link>
          {navigation ? (
            <>
              <span
                aria-hidden="true"
                className="hidden h-4 w-px shrink-0 bg-slate-200 lg:block"
              />
              <div className="col-start-1 row-start-2 min-w-0 lg:row-start-auto">
                {navigation}
              </div>
            </>
          ) : null}
          <div aria-hidden="true" className="hidden lg:block lg:flex-1" />
          <div className="col-start-2 row-start-2 flex items-center justify-end gap-0.5 justify-self-end lg:contents">
            {help ? <div className="shrink-0">{help}</div> : null}
            <div className="shrink-0">{theme}</div>
          </div>
          <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 justify-self-end lg:contents">
            <div className="shrink-0 lg:ml-1">{language}</div>
            {trailingAction ? (
              <>
                <span
                  aria-hidden="true"
                  className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 lg:block"
                />
                <div className="shrink-0">{trailingAction}</div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </header>
  );
}
