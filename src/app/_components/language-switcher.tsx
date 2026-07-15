"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { api } from "~/trpc/react";
import { setLocale } from "~/app/_actions/locale";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";
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
  // Fall back to the bundled built-ins until the dynamic list loads.
  const options =
    languages.data ??
    LOCALES.map((c) => ({ code: c, label: LOCALE_LABELS[c] ?? c }));

  const select = (
    <select
      aria-label={t("language")}
      className={`select py-0 ${
        embedded
          ? "h-11 w-full text-sm"
          : compact
            ? "h-8 w-auto text-xs"
            : compactAtDesktop
              ? "h-11 w-auto text-xs lg:h-8"
              : "h-11 w-auto text-xs"
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
