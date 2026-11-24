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

  const select = (
    <select
      aria-label={t("language")}
      className={`select py-0 font-medium text-slate-700 disabled:cursor-wait ${
        embedded
          ? "h-11 w-full text-sm"
          : compact
            ? "control-compact field-auto h-8 text-[13px]"
            : compactAtDesktop
              ? "control-compact field-auto h-11 text-[13px] lg:h-8"
              : "control-compact field-auto h-11 text-[13px]"
      }`}
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
