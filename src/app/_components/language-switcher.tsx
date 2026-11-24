"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { api } from "~/trpc/react";
import { setLocale } from "~/app/_actions/locale";
import { DEFAULT_ENABLED_LOCALES, LOCALE_LABELS } from "~/i18n/config";
import { useHeaderMenuClose } from "~/app/_components/header-menu";

/**
 * Persists the locale to a cookie and refreshes server components. `compact`
 * restores the public desktop header height, while `compactAtDesktop` keeps
 * dashboard mobile controls touch-sized and trims only wide layouts.
 */
export function LanguageSwitcher({
  embedded = false,
  compact = false,
  compactAtDesktop = false,
}: {
  embedded?: boolean;
  compact?: boolean;
  compactAtDesktop?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("common");
  const closeHeaderMenu = useHeaderMenuClose();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const languages = api.i18n.languages.useQuery();
  // Avoid briefly exposing unfinished catalogs while the dynamic list loads.
  const options =
    languages.data ??
    DEFAULT_ENABLED_LOCALES.map((c) => ({ code: c, label: LOCALE_LABELS[c] ?? c }));

  const heightClass = embedded
    ? "h-11 w-full text-sm"
    : compact
      ? "h-8 text-[13px]"
      : compactAtDesktop
        ? "h-11 text-[13px] lg:h-8"
        : "h-11 text-[13px]";

  const select = (
    <div
      className={`relative inline-flex items-center ${embedded ? "w-full" : "w-auto"}`}
    >
      <select
        aria-label={t("language")}
        className={`focus:border-accent-500 focus:ring-accent-500 cursor-pointer appearance-none rounded-md border border-slate-200/90 bg-white py-0 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:ring-1 focus:outline-hidden disabled:cursor-wait disabled:opacity-60 ${
          embedded ? "pr-8 pl-3" : "field-auto pr-7 pl-2.5"
        } ${heightClass}`}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          closeHeaderMenu();
          startTransition(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
      >
        {options.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 6.25 8 9.75l3.5-3.5" />
      </svg>
    </div>
  );

  if (embedded) {
    return (
      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {t("language")}
        </span>
        {select}
      </label>
    );
  }

  return select;
}
