"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { HelpCircleIcon } from "./icons";

/**
 * Quiet top-bar Question Mark entrance to the Help Center, aligned with NotificationBell
 * and ThemeSwitcher as a cohesive 32px desktop / 44px mobile icon control.
 * Automatically hidden when the user is already inside the Help Center (`/help`).
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
      className="focus-visible:ring-accent-500 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:h-8 lg:w-8"
    >
      <HelpCircleIcon className="h-5 w-5 shrink-0 lg:h-4 lg:w-4" />
    </Link>
  );
}
