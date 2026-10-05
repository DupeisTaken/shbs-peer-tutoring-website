"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useBranding } from "./branding-provider";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

/** The frame is also used by local gallery examples; production utilities keep
 * their existing preference behavior and one instance per page. */
export function PublicHeader({
  navigation,
  sticky = true,
}: {
  navigation?: ReactNode;
  sticky?: boolean;
}) {
  const { APP_TITLE } = useBranding();
  return (
    <PublicHeaderFrame
      title={APP_TITLE}
      navigation={navigation}
      sticky={sticky}
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
}: {
  title: string;
  language: ReactNode;
  theme: ReactNode;
  navigation?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      data-sticky-header={sticky || undefined}
      className={`${sticky ? "sticky top-0 z-20" : ""} border-b border-slate-200 bg-white`}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:flex">
        <Link
          href="/"
          className="flex min-h-11 min-w-0 items-center text-xl font-bold break-words text-slate-900 lg:order-1 lg:mr-auto lg:min-h-8 lg:text-lg"
        >
          {title}
        </Link>
        <div className="justify-self-end lg:order-4">{language}</div>
        <div className="min-w-0 lg:order-2">{navigation}</div>
        <div className="justify-self-end lg:order-3">{theme}</div>
      </div>
    </header>
  );
}
