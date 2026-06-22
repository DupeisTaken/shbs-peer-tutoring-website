"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { THEMES, DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from "~/lib/theme";

/**
 * Swatch per theme: a circle split diagonally ("/") into two true shades of the theme — a lighter
 * tone on one half and the deeper accent on the other (hard gradient stop at 50%, so each half is
 * a solid, accurate color). Uses literal palette utilities so swatches show real theme colors.
 */
const SWATCH: Record<Theme, string> = {
  indigo: "bg-gradient-to-br from-indigo-400 from-50% to-indigo-700 to-50%",
  violet: "bg-gradient-to-br from-violet-400 from-50% to-violet-700 to-50%",
  emerald: "bg-gradient-to-br from-emerald-400 from-50% to-emerald-700 to-50%",
  rose: "bg-gradient-to-br from-rose-400 from-50% to-rose-700 to-50%",
  amber: "bg-gradient-to-br from-amber-400 from-50% to-amber-700 to-50%",
  sky: "bg-gradient-to-br from-sky-400 from-50% to-sky-700 to-50%",
};

/**
 * Accent-theme picker: a swatch button that opens a small dialog of color swatches. Applies
 * instantly by setting `data-theme` on <html> and persists the choice in a cookie (read back SSR
 * by the root layout). State-controlled popover so the open/close is reliable.
 */
export function ThemeSwitcher() {
  const t = useTranslations();
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sync from the SSR-applied attribute after mount (keeps server/client markup identical).
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (isTheme(current)) setTheme(current);
  }, []);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (next: Theme) => {
    setTheme(next);
    setOpen(false);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("components.theme.label")}
        title={t("components.theme.label")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center rounded-md px-1 hover:bg-slate-100"
      >
        <span className={`h-5 w-5 rounded-full ring-1 ring-slate-300 ${SWATCH[theme]}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("components.theme.label")}
          className="absolute right-0 z-30 mt-2 w-40 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <p className="pb-2 text-xs font-medium text-slate-500">{t("components.theme.label")}</p>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((th) => {
              const selected = theme === th;
              return (
                <button
                  key={th}
                  type="button"
                  aria-label={t(`components.theme.names.${th}`)}
                  aria-pressed={selected}
                  title={t(`components.theme.names.${th}`)}
                  onClick={() => apply(th)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full ring-2 transition ${SWATCH[th]} ${
                    selected ? "ring-slate-800" : "ring-transparent hover:ring-slate-300"
                  }`}
                >
                  {selected && (
                    <span className="text-xs font-bold text-white drop-shadow-sm">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
