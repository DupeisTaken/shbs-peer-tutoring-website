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
  href = "/",
  navigation,
  trailingAction,
  title,
  linkTitle,
  hideTitle = false,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
  showHelp = true,
}: {
  /** Destination for clicking the PT logo and title (defaults to Program Home `/`). */
  href?: string;
  navigation?: ReactNode;
  /** Optional primary menu/action anchored to the far right (e.g. Sign In & Join on Program Home). */
  trailingAction?: ReactNode;
  /** Optional location title beside the PT logo (defaults to configured APP_TITLE). */
  title?: string;
  /** Optional tooltip title for the brand link (defaults to `title`). */
  linkTitle?: string;
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
      href={href}
      title={title ?? APP_TITLE}
      linkTitle={linkTitle}
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

/** Balanced, tidy public header: official PT logo + bold brand-lockup title anchor the left
 * on desktop and center cleanly on mobile row 1 (clicking returns to `href`, defaulting to
 * Program Home `/`), optional navigation sits beside the title on desktop or left on mobile
 * row 2, and ?, Theme, Language, plus an optional far-right action/menu stay grouped together. */
export function PublicHeaderFrame({
  href = "/",
  navigation,
  trailingAction,
  title,
  linkTitle,
  hideTitle = false,
  help,
  language,
  theme,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
}: {
  href?: string;
  title: string;
  linkTitle?: string;
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
  return (
    <header
      data-sticky-header={sticky || undefined}
      className={`${sticky ? "sticky top-0 z-20" : ""} w-full border-t-[2.5px] border-t-[color:var(--action-background)] border-b border-slate-200 bg-white/95 shadow-[0_1px_3px_rgba(15,23,42,0.06)] backdrop-blur-xs`}
    >
      {skipLabel ? (
        <a href={`#${skipToId}`} className="skip-link">
          {skipLabel}
        </a>
      ) : null}

      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-1.5 px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:gap-1.5 lg:px-6 lg:py-2.5">
        <div className="flex min-w-0 items-center justify-center lg:contents">
          <Link
            href={href}
            title={linkTitle ?? title}
            aria-label={hideTitle ? title : undefined}
            className="focus-visible:ring-accent-500 flex min-h-11 max-w-full min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 text-xl font-bold tracking-tight text-slate-900 transition hover:bg-slate-100/80 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:-ml-1 lg:min-h-8 lg:shrink-0 lg:text-lg"
          >
            <BrandMark className="h-8 w-8" />
            {!hideTitle ? (
              <span className="min-w-0 truncate">{title}</span>
            ) : null}
          </Link>
        </div>

        {navigation ? (
          <span
            aria-hidden="true"
            className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 lg:block"
          />
        ) : null}

        <div aria-hidden="true" className="h-px bg-slate-100 lg:hidden" />

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 lg:contents">
          {navigation ? (
            <>
              <div className="min-w-0">{navigation}</div>
              <div aria-hidden="true" className="hidden lg:block lg:flex-1" />
              <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 lg:contents">
                <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
                  {help ? (
                    <div className="shrink-0 empty:hidden">{help}</div>
                  ) : null}
                  <div className="shrink-0">{theme}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2 lg:contents">
                  <div className="shrink-0 lg:ml-1.5">{language}</div>
                  {trailingAction ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="mx-2 hidden h-5 w-px shrink-0 bg-slate-200 lg:block"
                      />
                      <div className="shrink-0">{trailingAction}</div>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <>
              <div aria-hidden="true" className="hidden lg:block lg:flex-1" />
              <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
                {help ? (
                  <div className="shrink-0 empty:hidden">{help}</div>
                ) : null}
                <div className="shrink-0">{theme}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 lg:contents">
                <div className="shrink-0 lg:ml-1.5">{language}</div>
                {trailingAction ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="mx-2 hidden h-5 w-px shrink-0 bg-slate-200 lg:block"
                    />
                    <div className="shrink-0">{trailingAction}</div>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
