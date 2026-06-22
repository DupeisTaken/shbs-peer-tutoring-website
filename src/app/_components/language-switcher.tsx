"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { api } from "~/trpc/react";
import { setLocale } from "~/app/_actions/locale";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";

/** Compact locale picker; persists the choice to a cookie and refreshes server components. */
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const languages = api.i18n.languages.useQuery();
  // Fall back to the bundled built-ins until the dynamic list loads.
  const options = languages.data ?? LOCALES.map((c) => ({ code: c, label: LOCALE_LABELS[c] ?? c }));

  return (
    <select
      aria-label="Language"
      className="select h-8 w-auto py-0 text-xs"
      value={locale}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
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
}
