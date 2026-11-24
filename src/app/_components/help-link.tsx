"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { HelpCircleIcon } from "./icons";

/**
 * Soft circular top-bar Question Mark entrance to the Help Center, matched to the
 * 32px desktop / 36px mobile circular badge geometry of NotificationBell, ThemeSwitcher,
 * and UserAvatar. Automatically hidden when already inside the Help Center (`/help`).
 */
export function HelpLink({ label }: { label?: string }) {
  const t = useTranslations("helpNav");
  const pathname = usePathname();
  const text = label ?? t("title");
  const active = pathname === "/help" || pathname.startsWith("/help/");

  if (active) return null;

  return (
    <Link
      href="/help"
      aria-label={text}
      title={text}
      className="group/help focus-visible:ring-accent-500 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:h-8 lg:w-8"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/90 bg-slate-100/80 text-slate-700 transition group-hover/help:border-slate-300 group-hover/help:bg-slate-200/70 group-hover/help:text-slate-950 lg:h-8 lg:w-8">
        <HelpCircleIcon className="h-4 w-4 shrink-0" />
      </span>
    </Link>
  );
}
