"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { useBranding } from "./branding-provider";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

/** The frame is also used by local gallery examples; production utilities keep
 * their existing preference behavior and one instance per page. */
export function PublicHeader({
  navigation,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
}: {
  navigation?: ReactNode;
  sticky?: boolean;
  skipLabel?: string;
  skipToId?: string;
}) {
  const { APP_TITLE } = useBranding();
  return (
    <PublicHeaderFrame
      title={APP_TITLE}
      navigation={navigation}
      sticky={sticky}
      skipLabel={skipLabel}
      skipToId={skipToId}
      language={<LanguageSwitcher compactAtDesktop />}
      theme={<ThemeSwitcher compactAtDesktop />}
    />
  );
}

/** Reorder one set of utilities, keeping language beside the brand on mobile.
 * Navigation stays in flow and can wrap; long names must never hide controls. */
export function PublicHeaderFrame({
  navigation,
  title,
  language,
  theme,
  sticky = true,
  skipLabel,
  skipToId = "main-content",
}: {
  title: string;
  language: ReactNode;
  theme: ReactNode;
  navigation?: ReactNode;
  sticky?: boolean;
  skipLabel?: string;
  skipToId?: string;
}) {
  return (
    <header
      data-sticky-header={sticky || undefined}
      className={`${sticky ? "sticky top-0 z-20" : ""} border-b border-slate-200 bg-white`}
    >
      {skipLabel ? (
        <a href={`#${skipToId}`} className="skip-link">
          {skipLabel}
        </a>
      ) : null}
      <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:flex lg:py-3">
        <Link
          href="/"
          className="col-start-1 row-start-1 flex min-h-11 min-w-0 items-center gap-2.5 text-xl font-bold break-words text-slate-900 lg:mr-auto lg:min-h-8 lg:text-lg"
        >
          <BrandMark />
          <span className="min-w-0">{title}</span>
        </Link>
        <div className="col-start-1 row-start-2 min-w-0 lg:row-start-auto">
          {navigation}
        </div>
        <div className="col-start-2 row-start-2 justify-self-end lg:row-start-auto">
          {theme}
        </div>
        <div className="col-start-2 row-start-1 justify-self-end lg:row-start-auto">
          {language}
        </div>
      </div>
    </header>
  );
}
